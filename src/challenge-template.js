const TEMPLATE_HEADERS = ['Name', 'Description', 'Points', 'Sort Order', 'Active'];

function escapeCsvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createChallengeTemplate(challenges = []) {
  const rows = [TEMPLATE_HEADERS, ...challenges.map((challenge) => [
    challenge.title,
    challenge.description,
    challenge.points,
    challenge.sort_order,
    challenge.active ? 'Yes' : 'No',
  ])];
  return `\ufeff${rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n')}\r\n`;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error('The template contains an unfinished quoted value.');
  values.push(value.trim());
  return values;
}

function parseChallengeTemplate(csv) {
  const lines = String(csv || '').replace(/^\ufeff/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('The challenge template is empty.');

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const requiredHeaders = ['name', 'description', 'points'];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`The template must include these columns: ${missingHeaders.map((header) => header[0].toUpperCase() + header.slice(1)).join(', ')}.`);
  }

  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const name = String(row.name).trim();
    const description = String(row.description).trim();
    const points = Number(row.points);
    const sortOrder = row['sort order'] === '' ? null : Number(row['sort order']);
    const activeValue = String(row.active || 'yes').toLowerCase();

    if (!name || !description || !Number.isInteger(points) || points < 0) {
      throw new Error(`Row ${rowIndex + 2} must include Name, Description, and a whole-number Points value of zero or greater.`);
    }
    if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 1)) {
      throw new Error(`Row ${rowIndex + 2} has an invalid Sort Order. Use a positive whole number or leave it blank.`);
    }
    if (!['yes', 'true', '1', 'no', 'false', '0'].includes(activeValue)) {
      throw new Error(`Row ${rowIndex + 2} has an invalid Active value. Use Yes or No.`);
    }

    return {
      title: name,
      description,
      points,
      sort_order: sortOrder,
      active: ['yes', 'true', '1'].includes(activeValue),
    };
  });
}

module.exports = { createChallengeTemplate, parseChallengeTemplate };