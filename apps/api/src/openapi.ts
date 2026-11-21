// OpenAPI description of the integration API, served at /api/integrations/openapi.json and shown in the
// API explorer. Keep it in step with integrations.ts; the API test checks that every route is described.

const error = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] };
const err = (description: string) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Sentinel integration API',
    version: '1.0.0',
    description:
      'Lets other internal systems file approval requests in Sentinel and learn the outcome.\n\n' +
      'A request filed here follows the flow in effect exactly like one filed in the Sentinel app: approvers come from the organization tree and the authority matrix, and the requester can never approve their own request.\n\n' +
      'Authenticate with the API key a system administrator creates under **Integrations** (`Authorization: Bearer sk_sentinel_...`). A key can file requests and read the requests it filed, nothing else.',
  },
  servers: [{ url: '/' }],
  security: [{ apiKey: [] }],
  tags: [{ name: 'Requests' }],
  paths: {
    '/api/integrations/flows': {
      get: {
        tags: ['Requests'],
        summary: 'List flows in effect',
        description: 'Flows that can receive requests now, with the form fields each one needs.',
        responses: {
          200: { description: 'Flows', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Flow' } } } } },
          401: err('Missing or invalid API key'),
        },
      },
    },
    '/api/integrations/requests': {
      post: {
        tags: ['Requests'],
        summary: 'File a request for an employee',
        description:
          'Starts a request for the employee with `requesterEmail`. Sending the same `externalRef` again returns the request created the first time (`duplicate: true`), so retries are safe. ' +
          '`callbackUrl` must be https and its host must be on the API client\'s allowed list; it receives the final outcome as a webhook.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewRequest' },
              example: {
                flowKey: 'purchase',
                requesterEmail: 'budi@contoh.test',
                externalRef: 'PR-1042',
                data: { amount: 1500000, category: 'atk', description: 'Printer paper for the production office' },
              },
            },
          },
        },
        responses: {
          201: { description: 'Request filed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Filed' } } } },
          200: { description: 'Same externalRef as an earlier call; the first request is returned', content: { 'application/json': { schema: { $ref: '#/components/schemas/Filed' } } } },
          400: err('Missing fields, invalid form data, or a callbackUrl that is not allowed'),
          401: err('Missing or invalid API key'),
          404: err('Flow not found or not yet in effect'),
          422: err('No employee with that email, or no approver could be found'),
        },
      },
    },
    '/api/integrations/requests/{id}': {
      get: {
        tags: ['Requests'],
        summary: 'Read a request this system filed',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'REQ-7F3A9C21' } }],
        responses: {
          200: { description: 'Request status', content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } } },
          401: err('Missing or invalid API key'),
          404: err('Not found, or filed by another system'),
        },
      },
    },
  },
  webhooks: {
    'request.finished': {
      post: {
        summary: 'A request was approved, rejected, or cancelled',
        description:
          'Sent to every webhook registered for the flow and to the request\'s callbackUrl. `event` is `request.approved`, `request.rejected`, or `request.cancelled`.\n\n' +
          'Verify `X-Sentinel-Signature: t=<unix seconds>,v1=<hex>`: compute HMAC-SHA256 of `<t>.<raw body>` with the signing secret and compare; reject old timestamps. ' +
          'Answer with any 2xx within 5 seconds. Other answers are retried after 1, 5, 30, 120, and 720 minutes.',
        parameters: [
          { name: 'X-Sentinel-Event', in: 'header', schema: { type: 'string' } },
          { name: 'X-Sentinel-Delivery', in: 'header', schema: { type: 'string' } },
          { name: 'X-Sentinel-Signature', in: 'header', schema: { type: 'string', example: 't=1763712000,v1=5f2c…' } },
        ],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } } },
        responses: { 200: { description: 'Received' } },
      },
    },
  },
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'API key from Integrations, starting with sk_sentinel_' } },
    schemas: {
      Error: error,
      Field: {
        type: 'object',
        properties: { key: { type: 'string' }, label: { type: 'string' }, type: { enum: ['number', 'string', 'boolean', 'date'] }, optional: { type: 'boolean' } },
        required: ['key', 'label', 'type'],
      },
      Flow: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, fields: { type: 'array', items: { $ref: '#/components/schemas/Field' } } } },
      NewRequest: {
        type: 'object',
        required: ['flowKey', 'requesterEmail'],
        properties: {
          flowKey: { type: 'string' },
          requesterEmail: { type: 'string', format: 'email' },
          data: { type: 'object', additionalProperties: true, description: 'Form values keyed by field key; numbers as numbers, dates as YYYY-MM-DD' },
          externalRef: { type: 'string', maxLength: 200, description: 'Your own ID for this request; makes retries safe' },
          callbackUrl: { type: 'string', format: 'uri', description: 'https URL on an allowed host that receives the outcome' },
        },
      },
      Filed: {
        type: 'object',
        properties: { id: { type: 'string' }, status: { type: 'string' }, waitingOn: { type: 'array', items: { type: 'string' } }, duplicate: { type: 'boolean' } },
      },
      Status: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          flowKey: { type: 'string' },
          status: { enum: ['in_progress', 'approved', 'rejected', 'revision_requested', 'cancelled'] },
          externalRef: { type: ['string', 'null'] },
          submittedAt: { type: 'string', format: 'date-time' },
          waitingOn: { type: 'array', items: { type: 'string' }, description: 'Step IDs with an open approval task' },
        },
      },
      WebhookEvent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          event: { enum: ['request.approved', 'request.rejected', 'request.cancelled'] },
          occurredAt: { type: 'string', format: 'date-time' },
          request: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              flowKey: { type: 'string' },
              flowVersionId: { type: 'string' },
              status: { type: 'string' },
              externalRef: { type: ['string', 'null'] },
              requesterEmail: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  },
} as const;
