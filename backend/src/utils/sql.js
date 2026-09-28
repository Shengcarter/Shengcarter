'use strict';

/** Escape LIKE wildcards so user input is matched literally. */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

const contains = (value) => `%${escapeLike(value)}%`;
const startsWith = (value) => `${escapeLike(value)}%`;

module.exports = { escapeLike, contains, startsWith };
