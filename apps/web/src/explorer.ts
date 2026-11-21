// The API explorer embedded under Integrations: Swagger UI over the integration API's OpenAPI description.
// "Try it out" calls the real API with the API key entered under Authorize; the key is not stored.
import SwaggerUIBundle from 'swagger-ui-dist/swagger-ui-bundle.js';
import 'swagger-ui-dist/swagger-ui.css';
import './explorer.css';

SwaggerUIBundle({
  url: '/api/integrations/openapi.json',
  dom_id: '#swagger',
  deepLinking: false,
  persistAuthorization: false,
  tryItOutEnabled: true,
  defaultModelsExpandDepth: 0,
  docExpansion: 'list',
});
