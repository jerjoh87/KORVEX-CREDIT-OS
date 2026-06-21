import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function safeLines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trimEnd());
}

function wrapText(font, text, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

async function addTextPage(pdf, { title, subtitle, body, footer, accent = rgb(0.06, 0.73, 0.51) }) {
  const page = pdf.addPage([612, 792]);
  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 54;
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.TimesRoman);
  const smallFont = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText('CREDITOS', { x: margin, y: height - 52, size: 18, font: titleFont, color: accent });
  page.drawText(String(title || ''), {
    x: width - margin,
    y: height - 52,
    size: 10,
    font: smallFont,
    color: rgb(0.35, 0.35, 0.35),
    align: 'right'
  });
  page.drawLine({ start: { x: margin, y: height - 66 }, end: { x: width - margin, y: height - 66 }, thickness: 1.2, color: accent });

  let y = height - 96;
  if (subtitle) {
    page.drawText(String(subtitle), {
      x: margin,
      y,
      size: 12,
      font: smallFont,
      color: rgb(0.18, 0.18, 0.18)
    });
    y -= 22;
  }

  const bodySize = 11;
  const lineGap = 15;
  const maxWidth = width - (margin * 2);
  const paragraphs = safeLines(body).join('\n').split('\n');

  for (const paragraph of paragraphs) {
    const lines = paragraph ? wrapText(bodyFont, paragraph, bodySize, maxWidth) : [''];
    for (const line of lines) {
      if (y < 72) {
        page.drawText('Continued on next page…', {
          x: margin,
          y: 34,
          size: 8,
          font: smallFont,
          color: rgb(0.45, 0.45, 0.45)
        });
        y = height - 58;
      }
      page.drawText(line, {
        x: margin,
        y,
        size: bodySize,
        font: bodyFont,
        color: rgb(0.1, 0.1, 0.1)
      });
      y -= lineGap;
    }
    y -= 4;
  }

  if (footer) {
    page.drawText(String(footer), {
      x: margin,
      y: 24,
      size: 8,
      font: smallFont,
      color: rgb(0.45, 0.45, 0.45)
    });
  }
}

async function embedDocumentPages(pdf, { bytes, mimeType }) {
  const type = String(mimeType || '').toLowerCase();
  if (type.includes('pdf')) {
    const source = await PDFDocument.load(bytes);
    const pages = await pdf.copyPages(source, source.getPageIndices());
    for (const page of pages) pdf.addPage(page);
    return;
  }

  const page = pdf.addPage([612, 792]);
  const width = page.getWidth();
  const height = page.getHeight();
  const margin = 36;

  let image;
  if (type.includes('png')) {
    image = await pdf.embedPng(bytes);
  } else if (type.includes('jpg') || type.includes('jpeg')) {
    image = await pdf.embedJpg(bytes);
  } else {
    await addTextPage(pdf, {
      title: 'Support document',
      subtitle: 'Unsupported file type',
      body: 'CREDITOS could not render this file type into the mailing packet. The file is included only as a reference attachment.',
      footer: 'Verify all support documents before mailing.'
    });
    return;
  }

  const scale = Math.min((width - margin * 2) / image.width, (height - margin * 2) / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
}

export async function createCertifiedMailPacket({
  letterText,
  billingAddress = {},
  recipientAddress = {},
  supportDocs = []
}) {
  const pdf = await PDFDocument.create();
  const coverBody = [
    'Certified mailing packet prepared by CREDITOS.',
    '',
    'Recipient address:',
    `${recipientAddress.name || recipientAddress.organization || 'Recipient'}`,
    `${recipientAddress.address1 || ''}`,
    `${recipientAddress.address2 || ''}`,
    `${[recipientAddress.city, recipientAddress.state, recipientAddress.postalCode].filter(Boolean).join(', ')}`,
    `${recipientAddress.country || 'United States'}`,
    '',
    'Return / billing address:',
    `${billingAddress.fullName || billingAddress.name || 'Client'}`,
    `${billingAddress.address1 || ''}`,
    `${billingAddress.address2 || ''}`,
    `${[billingAddress.city, billingAddress.state, billingAddress.postalCode].filter(Boolean).join(', ')}`,
    `${billingAddress.country || 'United States'}`,
    '',
    `Included support documents: ${supportDocs.length || 0}`,
    '',
    'Review every page before the packet is mailed.'
  ].join('\n');

  await addTextPage(pdf, {
    title: 'Certified mail packet',
    subtitle: 'CREDITOS mailing cover sheet',
    body: coverBody,
    footer: 'For self-help use only. Confirm all details before sending.'
  });

  await addTextPage(pdf, {
    title: 'Dispute letter',
    subtitle: 'Primary letter to be mailed',
    body: letterText || 'No letter text provided.',
    footer: 'Generated with CREDITOS. Review all details before mailing.'
  });

  for (const doc of supportDocs) {
    await embedDocumentPages(pdf, doc);
  }

  return Buffer.from(await pdf.save());
}
