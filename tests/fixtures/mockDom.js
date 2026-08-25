// tests/fixtures/mockDom.js
//
// Purpose: lightweight DOM mock and serializer for v2 component unit tests
//   that manipulate the DOM (SVG elements, event listeners, innerHTML).

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

class DOMNode {
  constructor(tagName, namespaceURI = HTML_NS, ownerDocument = null) {
    this.tagName = String(tagName || '').toUpperCase();
    this.namespaceURI = namespaceURI;
    this.ownerDocument = ownerDocument;
    this.attributes = Object.create(null);
    this.children = [];
    this.parentNode = null;
    this._listeners = Object.create(null);
    this._style = Object.create(null);
    this._textContent = '';
  }

  get style() {
    const self = this;
    return new Proxy(this._style, {
      get(target, prop) {
        if (prop === 'cssText') {
          return Object.entries(target)
            .map(([k, v]) => `${k}:${v}`)
            .join(';');
        }
        return target[prop] || '';
      },
      set(target, prop, value) {
        if (prop === 'cssText') {
          for (const key of Object.keys(target)) delete target[key];
          if (value) {
            String(value)
              .split(';')
              .forEach(pair => {
                const idx = pair.indexOf(':');
                if (idx !== -1) {
                  const k = pair.slice(0, idx).trim();
                  const v = pair.slice(idx + 1).trim();
                  if (k) target[k] = v;
                }
              });
          }
          return true;
        }
        target[prop] = String(value ?? '');
        return true;
      }
    });
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(value) {
    if (value) {
      this.setAttribute('class', value);
    } else {
      this.removeAttribute('class');
    }
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get textContent() {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes[String(name).toLowerCase()] = String(value ?? '');
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributes[key] !== undefined ? this.attributes[key] : null;
  }

  removeAttribute(name) {
    delete this.attributes[String(name).toLowerCase()];
  }

  hasAttribute(name) {
    return this.attributes[String(name).toLowerCase()] !== undefined;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    if (!newChild) return newChild;
    if (newChild.parentNode) {
      newChild.parentNode.removeChild(newChild);
    }
    newChild.parentNode = this;
    newChild.ownerDocument = this.ownerDocument;
    const index = this.children.indexOf(refChild);
    if (index === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(index, 0, newChild);
    }
    return newChild;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(type, listener) {
    const key = String(type).toLowerCase();
    if (!this._listeners[key]) {
      this._listeners[key] = [];
    }
    this._listeners[key].push(listener);
  }

  removeEventListener(type, listener) {
    const key = String(type).toLowerCase();
    if (this._listeners[key]) {
      this._listeners[key] = this._listeners[key].filter(l => l !== listener);
    }
  }

  dispatchEvent(event) {
    const ev = typeof event === 'string' ? { type: event } : event;
    const key = String(ev.type || '').toLowerCase();
    if (!ev.target) ev.target = this;
    if (!ev.currentTarget) ev.currentTarget = this;
    if (typeof ev.preventDefault !== 'function') ev.preventDefault = () => {};
    const list = (this._listeners[key] || []).slice();
    for (const listener of list) {
      listener.call(this, ev);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  querySelector(selector) {
    return querySelectorOne(this, selector);
  }

  querySelectorAll(selector) {
    const results = [];
    querySelectorAllAll(this, selector, results);
    return results;
  }

  get innerHTML() {
    return serializeChildren(this);
  }

  set innerHTML(html) {
    this.children = [];
    this._textContent = '';
    parseHtmlInto(this, String(html ?? ''));
  }

  get outerHTML() {
    return serializeNode(this);
  }
}

function matchesSelector(node, selector) {
  if (!selector || typeof selector !== 'string') return false;
  const sel = selector.trim();

  if (sel.includes(',')) {
    return sel.split(',').some(part => matchesSelector(node, part.trim()));
  }

  const tagMatch = sel.match(/^[a-zA-Z0-9_-]+/);
  let rest = sel;
  if (tagMatch) {
    const expectedTag = tagMatch[0].toUpperCase();
    if (node.tagName !== expectedTag) return false;
    rest = sel.slice(expectedTag.length);
  }

  while (rest.length > 0) {
    if (rest.startsWith('.')) {
      const clsMatch = rest.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!clsMatch) return false;
      const cls = clsMatch[1];
      const classes = (node.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (!classes.includes(cls)) return false;
      rest = rest.slice(clsMatch[0].length);
    } else if (rest.startsWith('#')) {
      const idMatch = rest.match(/^#([a-zA-Z0-9_-]+)/);
      if (!idMatch) return false;
      if (node.getAttribute('id') !== idMatch[1]) return false;
      rest = rest.slice(idMatch[0].length);
    } else if (rest.startsWith('[')) {
      const endIdx = rest.indexOf(']');
      if (endIdx === -1) return false;
      const attrExpr = rest.slice(1, endIdx);
      rest = rest.slice(endIdx + 1);

      const eqIdx = attrExpr.indexOf('=');
      if (eqIdx === -1) {
        if (!node.hasAttribute(attrExpr)) return false;
      } else {
        const attrName = attrExpr.slice(0, eqIdx).trim();
        let attrVal = attrExpr.slice(eqIdx + 1).trim();
        if ((attrVal.startsWith('"') && attrVal.endsWith('"')) ||
            (attrVal.startsWith("'") && attrVal.endsWith("'"))) {
          attrVal = attrVal.slice(1, -1);
        }
        if (node.getAttribute(attrName) !== attrVal) return false;
      }
    } else {
      break;
    }
  }

  return true;
}

function querySelectorOne(root, selector) {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) return child;
    const found = querySelectorOne(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllAll(root, selector, results) {
  for (const child of root.children) {
    if (matchesSelector(child, selector)) {
      results.push(child);
    }
    querySelectorAllAll(child, selector, results);
  }
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function serializeNode(node) {
  if (!node) return '';
  const tag = node.tagName.toLowerCase();
  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');

  if (node.children.length === 0) {
    if (node._textContent) {
      return `<${tag}${attrs}>${escapeAttr(node._textContent)}</${tag}>`;
    }
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'circle', 'path', 'rect', 'line']);
    if (voidTags.has(tag)) {
      return `<${tag}${attrs} />`;
    }
    return `<${tag}${attrs}></${tag}>`;
  }

  const inner = node.children.map(serializeNode).join('');
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

function serializeChildren(node) {
  return (node.children || []).map(serializeNode).join('');
}

/**
 * Lightweight HTML parser for component template literals.
 */
function parseHtmlInto(parent, html) {
  const doc = parent.ownerDocument;
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9:-]+)([^>]*)>|([^<]+)/g;
  let match;
  let current = parent;
  const stack = [parent];

  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

  while ((match = tagRegex.exec(html)) !== null) {
    const [full, isClosing, tagName, attrString, text] = match;

    if (full.startsWith('<!--')) {
      continue;
    }

    if (text) {
      const decoded = text;
      if (decoded) {
        if (current.children.length === 0 && !current._textContent) {
          current._textContent = decoded;
        } else {
          const textNode = new DOMNode('#text', HTML_NS, doc);
          textNode._textContent = decoded;
          current.appendChild(textNode);
        }
      }
      continue;
    }

    if (isClosing) {
      const lowerTag = tagName.toLowerCase();
      while (stack.length > 1) {
        const top = stack.pop();
        if (top.tagName.toLowerCase() === lowerTag) {
          break;
        }
      }
      current = stack[stack.length - 1] || parent;
      continue;
    }

    const lowerTag = tagName.toLowerCase();
    const isSvg = lowerTag === 'svg' || (current && current.namespaceURI === SVG_NS);
    const ns = isSvg ? SVG_NS : HTML_NS;
    const element = new DOMNode(tagName, ns, doc);

    if (attrString) {
      const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrString)) !== null) {
        const name = attrMatch[1];
        const val = attrMatch[2] !== undefined
          ? attrMatch[2]
          : attrMatch[3] !== undefined
            ? attrMatch[3]
            : attrMatch[4] !== undefined
              ? attrMatch[4]
              : '';
        element.setAttribute(name, val);
      }
    }

    current.appendChild(element);

    const isSelfClosing = full.endsWith('/>') || voidTags.has(lowerTag);
    if (!isSelfClosing) {
      stack.push(element);
      current = element;
    }
  }
}

class MockDocument {
  constructor() {
    this.body = new DOMNode('body', HTML_NS, this);
    this.documentElement = new DOMNode('html', HTML_NS, this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new DOMNode(tagName, HTML_NS, this);
  }

  createElementNS(namespaceURI, tagName) {
    return new DOMNode(tagName, namespaceURI, this);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

function createMockEnvironment(extra = {}) {
  const document = new MockDocument();
  const window = {
    document,
    ...extra
  };
  return { document, window };
}

module.exports = {
  DOMNode,
  MockDocument,
  createMockEnvironment,
  serializeNode,
  serializeChildren
};
