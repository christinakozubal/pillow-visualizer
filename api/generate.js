module.exports = async function handler(req, res) {
  // CORS headers (allows the frontend to call this function)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OpenAI API key is not configured on this server.' });

  // Parse body (Vercel auto-parses JSON, but guard against string)
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { fabricImage, shape, size, style, trim, trimColor } = body;

  if (!fabricImage) return res.status(400).json({ error: 'No fabric image provided.' });

  try {
    // Step 1 — analyze the fabric swatch with GPT-4o vision
    const analysisResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: fabricImage } },
            {
              type: 'text',
              text: 'Describe this fabric swatch in precise detail for a product rendering prompt. Include: specific colors (names and tones), pattern type (solid, stripe, plaid, floral, herringbone, boucle, velvet, linen weave, etc.), texture (smooth, nubby, woven, fuzzy, etc.), sheen (matte, semi-gloss, shiny), and any notable design characteristics. Under 100 words, written as a descriptive clause starting with "fabric featuring..."'
            }
          ]
        }]
      })
    });

    const analysisData = await analysisResp.json();
    if (!analysisResp.ok) throw new Error(analysisData.error?.message || 'Fabric analysis failed.');

    const fabricDescription = analysisData.choices[0].message.content.trim();

    // Step 2 — build the image generation prompt
    const prompt = buildPrompt(fabricDescription, shape, size, style, trim, trimColor);

    // Step 3 — generate the pillow image
    const genResp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'high'
      })
    });

    const genData = await genResp.json();
    if (!genResp.ok) throw new Error(genData.error?.message || 'Image generation failed.');

    return res.status(200).json({
      image: genData.data[0],
      fabricDescription
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'An unexpected error occurred.' });
  }
};

function buildPrompt(fabricDescription, shape, size, style, trim, trimColor) {
  let shapeDesc;

  switch (shape) {
    case 'ball':
      shapeDesc = `perfectly round spherical ball pillow (${size} diameter), three-dimensional globe shape, smooth and evenly stuffed all the way around`;
      break;
    case 'knot':
      shapeDesc = `oversized decorative knotted pillow (${size} size), the fabric twisted and looped into a large, elegant hand-tied knot form — a sculptural, voluminous knot shape`;
      break;
    case 'lumbar':
      shapeDesc = `plump rectangular lumbar throw pillow (${size} inches), wide and low, well-stuffed with gently rounded edges`;
      break;
    default: // square
      shapeDesc = `plump square throw pillow (${size} inches), well-stuffed with soft rounded corners`;
  }

  let trimDesc = '';
  if (trim && trim !== 'none') {
    const tc = trimColor ? ` in ${trimColor}` : '';
    const trimMap = {
      piping:  `finished with a cord piping / welt trim${tc} sewn neatly along all seam edges`,
      fringe:  `adorned with a flowing tassel fringe trim${tc} along the bottom edge and sides`,
      velvet:  `bordered with a flat velvet ribbon trim${tc} sewn around the entire perimeter`,
      pompom:  `edged with small decorative pom-poms${tc} running along all four sides`
    };
    trimDesc = `, ${trimMap[trim] || ''}`;
  }

  return `Photorealistic professional product photograph of a ${shapeDesc}, upholstered entirely in ${fabricDescription}${trimDesc}. The pillow is full and plump, with realistic fabric draping, subtle natural creases, and careful stitching details. ${style}. The fabric's pattern, color, and texture are clearly visible and faithfully reproduced across the entire pillow surface. Clean neutral background, studio-quality lighting, soft shadows. 8K detail, commercial product photography. No text, no labels, no props, no other objects.`;
}
