import type { Express } from "express";

const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OCRecipes Verified Product API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
    h1 { margin-bottom: 0.5rem; }
    h2 { margin-top: 2rem; margin-bottom: 0.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.25rem; }
    h3 { margin-top: 1.5rem; margin-bottom: 0.25rem; }
    code { background: #f4f4f4; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 0.75rem 0; }
    pre code { background: none; padding: 0; }
    table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e5e5e5; }
    th { font-weight: 600; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.8em; font-weight: 600; }
    .badge-beta { background: #fef3c7; color: #92400e; }
    p { margin: 0.5rem 0; }
    ul { margin: 0.5rem 0 0.5rem 1.5rem; }
  </style>
</head>
<body>
  <h1>OCRecipes Verified Product API <span class="badge badge-beta">BETA</span></h1>
  <p>Human-verified nutrition data for barcoded products.</p>

  <h2>Authentication</h2>
  <p>All requests require an API key sent in the <code>X-API-Key</code> header.</p>
  <pre><code>curl -H "X-API-Key: ocr_live_your_key_here" \\
  https://api.ocrecipes.com/api/v1/products/012345678901</code></pre>
  <p><strong>Never</strong> pass your API key as a query parameter. Requests with <code>?api_key=</code> or <code>?apiKey=</code> will be rejected with a 400 error.</p>

  <h2>Endpoint</h2>
  <h3>GET /api/v1/products/:barcode</h3>
  <p>Look up nutrition data for a product by its barcode (UPC-A, EAN-13, or EAN-8). Barcodes must be 8-14 numeric digits. The API automatically tries common barcode variants (zero-padded, check-digit computed).</p>

  <h2>Tiers</h2>
  <table>
    <thead>
      <tr><th>Tier</th><th>Price</th><th>Requests/Month</th><th>Data</th></tr>
    </thead>
    <tbody>
      <tr><td>Free</td><td>$0</td><td>500</td><td>Unverified nutrition (calories, protein, carbs, fat)</td></tr>
      <tr><td>Starter</td><td>$29/mo</td><td>10,000</td><td>Verified + unverified, full metadata</td></tr>
      <tr><td>Pro</td><td>$99/mo</td><td>100,000</td><td>Verified + unverified, full metadata</td></tr>
    </tbody>
  </table>

  <h2>Response Format</h2>
  <h3>Free Tier</h3>
  <pre><code>{
  "data": {
    "barcode": "012345678901",
    "productName": "Whole Grain Cereal",
    "brandName": "HealthBrand",
    "servingSize": "30g",
    "calories": 120,
    "protein": 3,
    "carbs": 24,
    "fat": 1.5,
    "source": "usda",
    "verified": false
  }
}</code></pre>

  <h3>Paid Tier (Starter / Pro)</h3>
  <pre><code>{
  "data": {
    "barcode": "012345678901",
    "productName": "Whole Grain Cereal",
    "brandName": "HealthBrand",
    "servingSize": "30g",
    "calories": 120,
    "protein": 3,
    "carbs": 24,
    "fat": 1.5,
    "source": "verified",
    "verified": true,
    "verificationLevel": "verified",
    "verificationCount": 3,
    "lastVerifiedAt": "2026-03-15T10:00:00.000Z",
    "frontLabel": {
      "brand": "HealthBrand",
      "productName": "Whole Grain Cereal",
      "netWeight": "350g",
      "claims": ["Whole Grain", "No Added Sugar"]
    }
  }
}</code></pre>

  <h2>Rate Limiting</h2>
  <p>Every response includes rate limit headers:</p>
  <table>
    <thead>
      <tr><th>Header</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr><td><code>X-RateLimit-Limit</code></td><td>Monthly request quota</td></tr>
      <tr><td><code>X-RateLimit-Remaining</code></td><td>Requests remaining this month</td></tr>
      <tr><td><code>X-RateLimit-Reset</code></td><td>ISO 8601 timestamp when the quota resets</td></tr>
    </tbody>
  </table>
  <p>When the limit is exceeded, the API returns <code>429 Too Many Requests</code>.</p>

  <h2>Error Codes</h2>
  <table>
    <thead>
      <tr><th>HTTP Status</th><th>Code</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr><td>400</td><td>VALIDATION_ERROR</td><td>Invalid barcode format</td></tr>
      <tr><td>401</td><td>API_KEY_INVALID</td><td>Missing or invalid API key</td></tr>
      <tr><td>401</td><td>API_KEY_REVOKED</td><td>API key has been revoked</td></tr>
      <tr><td>404</td><td>NOT_FOUND</td><td>Product not found</td></tr>
      <tr><td>429</td><td>TIER_LIMIT_EXCEEDED</td><td>Monthly request limit exceeded</td></tr>
      <tr><td>500</td><td>INTERNAL_ERROR</td><td>Internal server error</td></tr>
    </tbody>
  </table>
  <p>All errors follow the format: <code>{ "error": "message", "code": "ERROR_CODE" }</code></p>

  <h2>Code Examples</h2>
  <h3>cURL</h3>
  <pre><code>curl -H "X-API-Key: ocr_live_your_key_here" \\
  https://api.ocrecipes.com/api/v1/products/012345678901</code></pre>

  <h3>JavaScript (fetch)</h3>
  <pre><code>const response = await fetch(
  "https://api.ocrecipes.com/api/v1/products/012345678901",
  { headers: { "X-API-Key": "ocr_live_your_key_here" } }
);
const { data } = await response.json();
console.log(data.calories); // 120</code></pre>

  <h3>Python (requests)</h3>
  <pre><code>import requests

resp = requests.get(
    "https://api.ocrecipes.com/api/v1/products/012345678901",
    headers={"X-API-Key": "ocr_live_your_key_here"}
)
data = resp.json()["data"]
print(data["calories"])  # 120</code></pre>
</body>
</html>`;

export function register(app: Express): void {
  app.get("/api/v1/docs", (_req, res) => {
    res.type("html").send(DOCS_HTML);
  });
}
