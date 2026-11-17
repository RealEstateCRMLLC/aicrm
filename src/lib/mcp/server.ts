/**
 * HyperNexus MCP Server
 *
 * Exposes the CRM's capabilities as Model Context Protocol (MCP) tools,
 * allowing any MCP-compatible AI agent (Claude Desktop, Cursor, custom
 * agents, etc.) to securely query and operate the CRM.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST (see https://modelcontextprotocol.io)
 */

import prisma from '@/lib/db/prisma';
import { searchTools } from '@/lib/hypernexus/tools';
import { swarmStart, swarmDebate, swarmConsensus } from '@/lib/hypernexus/swarm';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'hypernexus-crm';
export const SERVER_VERSION = '0.4.0';

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPSession {
  brokerageId: string;
  agentId?: string;
}

/**
 * Contacts are tenant-scoped in the current schema (Contact.tenantId);
 * the session carries a brokerageId. Resolve the tenant once per call -
 * querying Contact by brokerageId throws Prisma validation errors.
 */
async function tenantIdFor(session: MCPSession): Promise<string> {
  const brokerage = await prisma.brokerage.findUnique({
    where: { id: session.brokerageId },
    select: { tenantId: true },
  });
  if (!brokerage) throw new Error(`Brokerage "${session.brokerageId}" not found`);
  return brokerage.tenantId;
}

// ─── Tool Definitions ───────────────────────────────────────────

export const MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: 'list_contacts',
    description:
      'List contacts in the CRM. Supports search and lead-status filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by name, email, phone, or city' },
        status: {
          type: 'string',
          enum: ['new', 'active', 'hot', 'cold', 'closed_won', 'closed_lost'],
          description: 'Filter by lead status',
        },
        limit: { type: 'integer', description: 'Max results (default 25)', default: 25 },
      },
    },
  },
  {
    name: 'get_contact',
    description: 'Get full details for a single contact by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Contact ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new contact (optionally as a lead).',
    inputSchema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },
        source: { type: 'string' },
        isLead: { type: 'boolean', default: false },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'update_lead_stage',
    description: 'Update a lead status or move it to a different pipeline stage.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'Lead ID' },
        status: {
          type: 'string',
          enum: ['new', 'active', 'hot', 'cold', 'closed_won', 'closed_lost'],
        },
        stageId: { type: 'string', description: 'Optional pipeline stage ID' },
        stageName: { type: 'string', description: 'Optional pipeline stage name (e.g. "Contacted"); resolved within the brokerage' },
      },
      required: ['leadId'],
    },
  },
  {
    name: 'list_properties',
    description: 'List MLS properties in the brokerage.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'pending', 'sold', 'off_market'] },
        city: { type: 'string' },
        limit: { type: 'integer', default: 25 },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Create a follow-up task for an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        dueDate: { type: 'string', format: 'date-time' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        contactId: { type: 'string', description: 'Optional linked contact' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
      },
    },
  },
  {
    name: 'summarize_brokerage',
    description: 'Get summary statistics for the brokerage (contacts, leads, properties, tasks).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts by free-text query across name, email, phone, tags, city.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'log_activity',
    description: 'Log an activity (note) against a contact.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        type: { type: 'string', description: 'note, call, email, sms, meeting, showing' },
        description: { type: 'string' },
      },
      required: ['contactId', 'description'],
    },
  },
  {
    name: 'hypernexus_search_tools',
    description:
      'Search the HyperNexus control plane MCP tool catalog (26,000+ tools when the full backend is running).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'integer', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'hypernexus_swarm',
    description:
      'Run a multi-agent swarm operation via HyperNexus (start mission, debate, or seek consensus).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'debate', 'consensus'], default: 'start' },
        prompt: { type: 'string', description: 'Prompt for debate/consensus' },
        models: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
    },
  },
];

// ─── Tool Executors ─────────────────────────────────────────────

type ToolExecutor = (session: MCPSession, args: Record<string, unknown>) => Promise<unknown>;

const executors: Record<string, ToolExecutor> = {
  async list_contacts(session, args) {
    const tenantId = await tenantIdFor(session);
    const where: Record<string, unknown> = { tenantId };
    const search = args['search'] as string | undefined;
    const status = args['status'] as string | undefined;
    const limit = (args['limit'] as number) || 25;

    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }
    if (status) {
      where.leads = { some: { status } };
    }

    return prisma.contact.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, email: true,
        phone: true, stage: true, source: true,
        leads: { select: { id: true, status: true, stageId: true } },
      },
      take: Math.min(limit, 100),
      orderBy: { updatedAt: 'desc' },
    });
  },

  async get_contact(session, args) {
    const tenantId = await tenantIdFor(session);
    return prisma.contact.findFirst({
      where: { id: args['id'] as string, tenantId },
      include: {
        leads: { include: { stage: true } },
        tags: { include: { tag: true } },
      },
    });
  },

  async create_contact(session, args) {
    const tenantId = await tenantIdFor(session);
    const isLead = (args['isLead'] as boolean) || false;
    // Contact.agentId references AgentProfile (not the session's Agent);
    // attach the brokerage's first profile when one exists.
    const profile = await prisma.agentProfile.findFirst({
      where: { brokerageId: session.brokerageId },
      select: { id: true },
    });
    const contact = await prisma.contact.create({
      data: {
        tenantId,
        agentId: profile?.id ?? null,
        firstName: args['firstName'] as string,
        lastName: args['lastName'] as string,
        email: (args['email'] as string) || null,
        phone: (args['phone'] as string) || null,
        source: (args['source'] as string) || null,
      },
    });
    if (isLead) {
      await prisma.lead.create({ data: { contactId: contact.id } });
    }
    return contact;
  },

  async update_lead_stage(session, args) {
    const leadId = args['leadId'] as string;
    const tenantId = await tenantIdFor(session);
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, contact: { tenantId } },
    });
    if (!lead) throw new Error(`Lead "${leadId}" not found`);

    const data: Record<string, unknown> = {};
    if (args['status']) {
      const status = String(args['status']);
      const STATUSES = ['new', 'active', 'hot', 'cold', 'closed_won', 'closed_lost'];
      if (!STATUSES.includes(status)) {
        throw new Error(`Invalid status "${status}". Valid statuses: ${STATUSES.join(', ')}`);
      }
      data.status = status;
    }
    if (args['stageId']) {
      const stage = await prisma.pipelineStage.findFirst({
        where: { id: String(args['stageId']), pipeline: { brokerageId: session.brokerageId } },
      });
      if (!stage) throw new Error(`Stage "${args['stageId']}" not found in this brokerage`);
      data.stageId = stage.id;
      if (!lead.pipelineId) data.pipelineId = stage.pipelineId;
    }
    if (args['stageName']) {
      // The tool is NAMED update_lead_stage, so callers naturally pass
      // a stage name — which used to be silently ignored (a 200 no-op).
      // Resolve it against the brokerage's pipeline stages. Matched
      // case-insensitively in code: the libsql datasource does not
      // support Prisma's `mode: 'insensitive'` filter.
      const target = String(args['stageName']).toLowerCase();
      const stages = await prisma.pipelineStage.findMany({
        where: {
          pipeline: {
            brokerageId: session.brokerageId,
            ...(lead.pipelineId ? { id: lead.pipelineId } : {}),
          },
        },
      });
      const stage = stages.find((s) => s.name.toLowerCase() === target);
      if (!stage) throw new Error(`Stage "${args['stageName']}" not found in this brokerage's pipelines`);
      data.stageId = stage.id;
      if (!lead.pipelineId) data.pipelineId = stage.pipelineId;
    }
    if (Object.keys(data).length === 0) {
      throw new Error('Nothing to update: provide status, stageId, or stageName');
    }
    data.lastContacted = new Date();

    return prisma.lead.update({ where: { id: leadId }, data });
  },

  async list_properties(session, args) {
    const where: Record<string, unknown> = { brokerageId: session.brokerageId };
    if (args['status']) where.status = args['status'];
    if (args['city']) where.city = { contains: args['city'] as string };
    const limit = (args['limit'] as number) || 25;

    return prisma.property.findMany({
      where,
      take: Math.min(limit, 100),
      orderBy: { createdAt: 'desc' },
    });
  },

  async create_task(session, args) {
    return prisma.task.create({
      data: {
        agentId: session.agentId!,
        title: args['title'] as string,
        description: (args['description'] as string) || null,
        dueDate: args['dueDate'] ? new Date(args['dueDate'] as string) : null,
        priority: (args['priority'] as string) || 'medium',
        contactId: (args['contactId'] as string) || null,
      },
    });
  },

  async list_tasks(session, args) {
    const where: Record<string, unknown> = { agentId: session.agentId };
    if (args['status']) where.status = args['status'];
    return prisma.task.findMany({ where, orderBy: { dueDate: 'asc' } });
  },

  async summarize_brokerage(session) {
    const tenantId = await tenantIdFor(session);
    const [contacts, leads, hotLeads, properties, pendingTasks] = await Promise.all([
      prisma.contact.count({ where: { tenantId } }),
      prisma.lead.count({ where: { contact: { tenantId } } }),
      prisma.lead.count({ where: { contact: { tenantId }, status: 'hot' } }),
      prisma.property.count({ where: { brokerageId: session.brokerageId } }),
      prisma.task.count({ where: { agent: { brokerageId: session.brokerageId }, status: 'pending' } }),
    ]);

    return {
      contacts,
      leads,
      hotLeads,
      properties,
      pendingTasks,
      summary: `${contacts} contacts, ${leads} leads (${hotLeads} hot), ${properties} properties, ${pendingTasks} pending tasks`,
    };
  },

  async search_contacts(session, args) {
    const tenantId = await tenantIdFor(session);
    const query = args['query'] as string;
    return prisma.contact.findMany({
      where: {
        tenantId,
        OR: [
          { firstName: { contains: query } },
          { lastName: { contains: query } },
          { email: { contains: query } },
          { phone: { contains: query } },
          { tags: { some: { tag: { name: { contains: query } } } } },
        ],
      },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        stage: true, source: true,
      },
      take: 25,
    });
  },

  async log_activity(session, args) {
    const tenantId = await tenantIdFor(session);
    const contact = await prisma.contact.findFirst({
      where: { id: args['contactId'] as string, tenantId },
      select: { id: true },
    });
    if (!contact) throw new Error(`Contact "${args['contactId'] as string}" not found`);
    return prisma.activity.create({
      data: {
        contactId: contact.id,
        type: (args['type'] as string) || 'note',
        description: args['description'] as string,
      },
    });
  },

  async hypernexus_search_tools(_session, args) {
    const res = await searchTools(
      args['query'] as string,
      (args['limit'] as number) || 20
    );
    return res.data?.results || res.data?.data || res.data || [];
  },

  async hypernexus_swarm(_session, args) {
    const action = (args['action'] as string) || 'start';
    if (action === 'debate') {
      return (await swarmDebate((args['prompt'] as string) || '')).data;
    }
    if (action === 'consensus') {
      return (await swarmConsensus((args['prompt'] as string) || '', (args['models'] as string[]) || [])).data;
    }
    return (await swarmStart()).data;
  },
};

// ─── JSON-RPC Handler ───────────────────────────────────────────

export interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function handleMCPRequest(
  method: string,
  params: Record<string, unknown>,
  id: number | string | null,
  session: MCPSession
): Promise<MCPResponse> {
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };

    case 'notifications/initialized':
      return { jsonrpc: '2.0', id, result: {} };

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS },
      };

    case 'tools/call': {
      const toolName = params?.['name'] as string;
      const toolArgs = (params?.['arguments'] as Record<string, unknown>) || {};
      const tool = MCP_TOOLS.find((t) => t.name === toolName);

      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        };
      }

      const executor = executors[toolName];
      if (!executor) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Tool not implemented: ${toolName}` },
        };
      }

      try {
        const result = await executor(session, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: err instanceof Error ? err.message : 'Tool execution failed',
          },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
