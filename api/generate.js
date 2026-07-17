
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  // Wrap everything so errors always come back as JSON (never HTML)
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not set on this server.' });
 
    // Robust body parsing — handles Vercel auto-parse, string, and raw stream
    let body;
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = await new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk.toString(); });
        req.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('Could not parse request body')); }
        });
        req.on('error', reject);
      });
    }
 
    const { fabricImage, shape, size, style, trim, trimColor } = body || {};
    if (!fabricImage) return res.status(400).json({ error: 'No fabric image provided.' });
 
    // Step 1 — analyze fabric with GPT-4o
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
              text: 'Describe this fabric swatch in precise detail for a product rendering prompt. Include: specific colors, pattern type (solid, stripe, plaid, floral, herringbone, boucle, velvet, linen weave, etc.), texture (smooth, nubby, woven, fuzzy, etc.), sheen (matte, semi-gloss, shiny), and any notable design characteristics. Under 100 words, starting with "fabric featuring..."'
            }
          ]
        }]
      })
    });
 
    const analysisData = await analysisResp.json();
    if (!analysisResp.ok) {
      return res.status(500).json({ error: analysisData.error?.message || 'Fabric analysis failed.' });
    }
 
    const fabricDescription = analysisData.choices[0].message.content.trim();
 
    // Step 2 — generate pillow image
    const prompt = buildPrompt(fabricDescription, shape, size, style, trim, trimColor);
 
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
    if (!genResp.ok) {
      return res.status(500).json({ error: genData.error?.message || 'Image generation failed.' });
    }
 
    return res.status(200).json({
      image: genData.data[0],
      fabricDescription
    });
 
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: err.message || 'An unexpected server error occurred.' });
  }
};
 
function buildPrompt(fabricDescription, shape, size, style, trim, trimColor) {
  const shapes = {
    square: `plump square throw pillow (${size} inches), well-stuffed with soft rounded corners`,
    lumbar: `plump rectangular lumbar throw pillow (${size} inches), wide and low, well-stuffed`,
    ball:   `perfectly round spherical ball pillow (${size} diameter), smooth three-dimensional globe shape`,
    knot:   `oversized decorative knotted pillow (${size} size), the fabric twisted and looped into a large sculptural hand-tied knot form`
  };
 
  let trimDesc = '';
  if (trim && trim !== 'none') {
    const tc = trimColor ? ` in ${trimColor}` : '';
    const trimMap = {
      piping:  `finished with cord piping/welt trim${tc} along all seam edges`,
      fringe:  `adorned with flowing tassel fringe${tc} along the edges`,
      velvet:  `bordered with a velvet ribbon trim${tc} around the perimeter`,
      pompom:  `edged with small decorative pom-poms${tc} along all sides`
    };
    trimDesc = `, ${trimMap[trim] || ''}`;
  }
 
  const shapeDesc = shapes[shape] || shapes.square;
  return `Photorealistic professional product photograph of a ${shapeDesc}, upholstered in ${fabricDescription}${trimDesc}. The pillow is full and plump with realistic fabric draping and careful stitching. ${style}. Fabric pattern and texture clearly visible and faithfully reproduced. Clean neutral background, studio-quality lighting, soft shadows. 8K detail, commercial product photography. No text, no labels, no props.`;
}
