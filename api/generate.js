module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not set on this server.' });

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

    // Step 1 — analyze fabric with GPT-4o (improved precision)
    const analysisResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: fabricImage } },
            {
              type: 'text',
              text: `You are a textile expert writing a precise fabric description for a photorealistic 3D rendering engine. Analyze this fabric swatch and describe it with maximum accuracy so that a rendering of this exact fabric on a pillow would be indistinguishable from the real thing.

Include ALL of the following:
- Exact colors using specific names (e.g. "warm ivory", "dusty sage green", "deep navy blue") — list every color present
- Pattern type and layout (solid, vertical stripes, horizontal stripes, plaid/tartan, herringbone, chevron, geometric, floral, abstract, boucle loops, velvet pile, linen plain weave, etc.)
- Pattern scale: how large or small the repeat is (e.g. "1-inch wide stripes", "small 0.5-inch diamond repeat", "large 4-inch floral motif")
- Weave/texture: the physical surface quality (tightly woven, loosely woven, looped boucle, cut velvet pile, nubby slub, smooth sateen, ribbed, waffle, etc.)
- Sheen level: matte / slight sheen / semi-gloss / high sheen / iridescent
- Fiber appearance: does it look like cotton, linen, wool, velvet, silk, synthetic, etc.
- Any notable details: fraying, metallic threads, embroidery, pattern directionality

Format: Start with "A fabric featuring" and write 2-3 dense, specific sentences. Do not generalize. Every detail must be accurate to this specific swatch.`
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

    // Step 2 — generate pillow image (improved fidelity prompt)
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
    square: `a plump, well-stuffed square throw pillow (${size} inches), with soft rounded corners and even fullness across all sides`,
    lumbar: `a plump, well-stuffed rectangular lumbar throw pillow (${size} inches), wide and low-profile with gently rounded edges`,
    ball:   `a perfectly round spherical ball pillow (${size} diameter), smooth and evenly filled with a continuous three-dimensional globe shape`,
    knot:   `an oversized decorative knotted pillow (${size} size), the fabric twisted and looped into a large sculptural hand-tied knot form with fabric folds clearly visible`
  };

  let trimDesc = '';
  if (trim && trim !== 'none') {
    const tc = trimColor ? ` in ${trimColor}` : '';
    const trimMap = {
      piping:  `finished with a tailored cord piping/welt trim${tc} sewn precisely along all seam edges`,
      fringe:  `adorned with flowing tassel fringe${tc} along all edges, each tassel hanging evenly`,
      velvet:  `bordered with a wide velvet ribbon trim${tc} sewn flat around the entire perimeter`,
      pompom:  `edged with evenly spaced small decorative pom-poms${tc} along all sides`
    };
    trimDesc = `, ${trimMap[trim] || ''}`;
  }

  const shapeDesc = shapes[shape] || shapes.square;

  return `Photorealistic commercial product photograph of ${shapeDesc}. The pillow is upholstered in ${fabricDescription}${trimDesc}.

CRITICAL — fabric accuracy: The exact colors, pattern, scale, weave texture, and surface sheen described above must be faithfully and precisely reproduced on the pillow surface. The fabric should look as if the actual described textile was cut and sewn onto the pillow — not a generic interpretation. Pattern repeats must be correctly scaled and aligned. Texture must be visible up close.

The pillow is plump and full, with realistic fabric draping, natural light shadows in the folds, and clean visible stitching at the seams. ${style}. Shot at a slight angle to show depth and dimensionality. Macro-level fabric detail visible. Ultra-sharp focus on the fabric surface. 8K resolution, commercial interior product photography. Neutral background with soft studio lighting. No text, no labels, no props, no people.`;
}
