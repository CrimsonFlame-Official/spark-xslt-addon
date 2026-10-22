// XSLT add-on for Spark.
//
// A small, dependency-free XSLT 1.0 core-subset processor written in plain
// JavaScript. It parses XML and XSLT stylesheets itself (no DOM needed), so
// the same file runs in Node and in a browser via a plain script tag.
//
// Public API:
//   transform(xmlString, xsltString) -> string
//   parseXML(xmlString) -> document node

(function (global) {
  'use strict';

  var XSLT_NS = 'http://www.w3.org/1999/XSL/Transform';

  // ------------------------------------------------------------ node model
  // Nodes are plain objects:
  //   { type: 'document'|'element'|'text'|'attribute',
  //     name, prefix, local, nsURI,        // elements / attributes
  //     attrs: [attribute nodes],          // elements only
  //     children: [nodes],                 // document / elements
  //     parent, value }                    // text / attribute value

  function makeNode(type) {
    return {
      type: type,
      name: null,
      prefix: null,
      local: null,
      nsURI: null,
      ns: null,
      attrs: [],
      children: [],
      parent: null,
      value: null
    };
  }

  function splitQName(qname) {
    var idx = qname.indexOf(':');
    if (idx === -1) return { prefix: null, local: qname };
    return { prefix: qname.slice(0, idx), local: qname.slice(idx + 1) };
  }

  function getAttr(el, name) {
    if (!el || !el.attrs) return null;
    for (var i = 0; i < el.attrs.length; i++) {
      if (el.attrs[i].name === name) return el.attrs[i].value;
    }
    return null;
  }

  function stringValue(node) {
    if (!node) return '';
    if (node.type === 'text' || node.type === 'attribute') return node.value || '';
    var out = '';
    for (var i = 0; i < node.children.length; i++) out += stringValue(node.children[i]);
    return out;
  }

  function rootOf(node) {
    var n = node;
    while (n && n.parent) n = n.parent;
    return n;
  }

  function cloneNode(node) {
    if (node.type === 'document') {
      return node.children.map(cloneNode);
    }
    var c = makeNode(node.type);
    c.name = node.name;
    c.prefix = node.prefix;
    c.local = node.local;
    c.nsURI = node.nsURI;
    c.value = node.value;
    var i, a;
    for (i = 0; i < node.attrs.length; i++) {
      a = cloneNode(node.attrs[i]);
      a.parent = c;
      c.attrs.push(a);
    }
    for (i = 0; i < node.children.length; i++) {
      var ch = cloneNode(node.children[i]);
      ch.parent = c;
      c.children.push(ch);
    }
    return c;
  }

  // ------------------------------------------------------------ XML parser

  var NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeEntities(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, function (m, body) {
      if (body.charAt(0) === '#') {
        var code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        return String.fromCharCode(code);
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : m;
    });
  }

  function parseXML(str) {
    if (typeof str !== 'string') throw new Error('parseXML: input must be a string');
    var doc = makeNode('document');
    var cur = doc;
    var curNs = {}; // prefix -> uri, '' is the default namespace
    var nsStack = [];
    var i = 0;
    var n = str.length;

    function fail(msg) {
      throw new Error('XML parse error at index ' + i + ': ' + msg);
    }

    function pushText(raw, decode) {
      if (!raw) return;
      var t = makeNode('text');
      t.value = decode ? decodeEntities(raw) : raw;
      t.parent = cur;
      cur.children.push(t);
    }

    while (i < n) {
      var lt = str.indexOf('<', i);
      if (lt === -1) {
        pushText(str.slice(i), true);
        break;
      }
      if (lt > i) pushText(str.slice(i, lt), true);
      i = lt;

      if (str.startsWith('<!--', i)) {
        var cEnd = str.indexOf('-->', i + 4);
        if (cEnd === -1) fail('unterminated comment');
        i = cEnd + 3; // comments are skipped
      } else if (str.startsWith('<![CDATA[', i)) {
        var cdEnd = str.indexOf(']]>', i + 9);
        if (cdEnd === -1) fail('unterminated CDATA section');
        pushText(str.slice(i + 9, cdEnd), false);
        i = cdEnd + 3;
      } else if (str.startsWith('<?', i)) {
        var piEnd = str.indexOf('?>', i + 2);
        if (piEnd === -1) fail('unterminated processing instruction');
        i = piEnd + 2;
      } else if (str.startsWith('<!', i)) {
        var dtEnd = str.indexOf('>', i + 2);
        if (dtEnd === -1) fail('unterminated declaration');
        i = dtEnd + 1; // DOCTYPE and friends: skipped
      } else if (str.startsWith('</', i)) {
        var eEnd = str.indexOf('>', i + 2);
        if (eEnd === -1) fail('unterminated end tag');
        var eName = str.slice(i + 2, eEnd).trim();
        if (cur === doc || cur.name !== eName) fail('mismatched end tag </' + eName + '>');
        cur = cur.parent;
        curNs = nsStack.pop();
        i = eEnd + 1;
      } else {
        // start tag or empty-element tag
        var j = i + 1;
        var nameStart = j;
        while (j < n && !/[\s/>]/.test(str.charAt(j))) j++;
        var qname = str.slice(nameStart, j);
        if (!qname) fail('expected element name');
        var parts = splitQName(qname);
        var el = makeNode('element');
        el.name = qname;
        el.prefix = parts.prefix;
        el.local = parts.local;

        var newNs = {};
        for (var k in curNs) newNs[k] = curNs[k];
        var attrList = [];
        var selfClose = false;

        while (j < n) {
          while (j < n && /\s/.test(str.charAt(j))) j++;
          if (str.startsWith('/>', j)) { selfClose = true; j += 2; break; }
          if (str.charAt(j) === '>') { j++; break; }
          var aStart = j;
          while (j < n && !/[\s=/>]/.test(str.charAt(j))) j++;
          var aName = str.slice(aStart, j);
          if (!aName) fail('expected attribute name in <' + qname + '>');
          while (j < n && /\s/.test(str.charAt(j))) j++;
          var aVal = '';
          if (str.charAt(j) === '=') {
            j++;
            while (j < n && /\s/.test(str.charAt(j))) j++;
            var quote = str.charAt(j);
            if (quote !== '"' && quote !== "'") fail('attribute ' + aName + ' must be quoted');
            var vEnd = str.indexOf(quote, j + 1);
            if (vEnd === -1) fail('unterminated attribute ' + aName);
            aVal = decodeEntities(str.slice(j + 1, vEnd));
            j = vEnd + 1;
          }
          var aParts = splitQName(aName);
          var at = makeNode('attribute');
          at.name = aName;
          at.prefix = aParts.prefix;
          at.local = aParts.local;
          at.value = aVal;
          at.parent = el;
          attrList.push(at);
          if (aName === 'xmlns') newNs[''] = aVal;
          else if (aParts.prefix === 'xmlns') newNs[aParts.local] = aVal;
        }

        el.attrs = attrList;
        el.ns = newNs;
        el.nsURI = parts.prefix ? (newNs[parts.prefix] || null) : (newNs[''] || null);
        for (var aidx = 0; aidx < el.attrs.length; aidx++) {
          var ap = el.attrs[aidx];
          ap.nsURI = ap.prefix ? (newNs[ap.prefix] || null) : null;
        }
        el.parent = cur;
        cur.children.push(el);
        if (!selfClose) {
          nsStack.push(curNs);
          curNs = newNs;
          cur = el;
        }
        i = j;
      }
    }
    if (cur !== doc) fail('unclosed element <' + cur.name + '>');
    return doc;
  }

  // ------------------------------------------------------------ XPath subset
  // Supported: / // . .. @attr @* * name text() node(), predicates,
  // and expressions built from paths, literals, numbers, comparisons
  // (= != < <= > >=), and/or, and a small set of functions.

  var FUNCTIONS = {
    'position': true, 'last': true, 'count': true, 'name': true,
    'concat': true, 'contains': true, 'starts-with': true, 'not': true,
    'string': true, 'normalize-space': true, 'true': true, 'false': true
  };

  function ExprParser(s) {
    this.s = s;
    this.i = 0;
  }

  ExprParser.prototype.skipWs = function () {
    while (this.i < this.s.length && /\s/.test(this.s.charAt(this.i))) this.i++;
  };

  ExprParser.prototype.peek = function () {
    return this.s.charAt(this.i);
  };

  ExprParser.prototype.readName = function () {
    var start = this.i;
    if (!/[A-Za-z_]/.test(this.peek())) return '';
    this.i++;
    while (/[A-Za-z0-9_.\-]/.test(this.peek())) this.i++;
    // one namespace prefix segment, e.g. xsl:template or ns:name
    if (this.peek() === ':' && this.s.charAt(this.i + 1) !== ':') {
      this.i++;
      while (/[A-Za-z0-9_.\-]/.test(this.peek())) this.i++;
    }
    return this.s.slice(start, this.i);
  };

  // Reads an operator word (and/or) if present; rewinds otherwise.
  ExprParser.prototype.readWordOp = function (word) {
    var save = this.i;
    this.skipWs();
    var w = this.readName();
    if (w === word) return true;
    this.i = save;
    return false;
  };

  ExprParser.prototype.parseExpr = function () {
    return this.parseOr();
  };

  ExprParser.prototype.parseOr = function () {
    var left = this.parseAnd();
    while (this.readWordOp('or')) {
      left = { t: 'or', l: left, r: this.parseAnd() };
    }
    return left;
  };

  ExprParser.prototype.parseAnd = function () {
    var left = this.parseCmp();
    while (this.readWordOp('and')) {
      left = { t: 'and', l: left, r: this.parseCmp() };
    }
    return left;
  };

  ExprParser.prototype.parseCmp = function () {
    var left = this.parsePrimary();
    this.skipWs();
    var ops = ['!=', '<=', '>=', '=', '<', '>'];
    for (var o = 0; o < ops.length; o++) {
      if (this.s.startsWith(ops[o], this.i)) {
        this.i += ops[o].length;
        return { t: 'cmp', op: ops[o], l: left, r: this.parsePrimary() };
      }
    }
    return left;
  };

  ExprParser.prototype.parsePrimary = function () {
    this.skipWs();
    var c = this.peek();
    if (c === '(') {
      this.i++;
      var inner = this.parseOr();
      this.skipWs();
      if (this.peek() !== ')') throw new Error('XPath: expected ) in ' + this.s);
      this.i++;
      return inner;
    }
    if (c === "'" || c === '"') {
      var quote = c;
      this.i++;
      var out = '';
      while (this.i < this.s.length) {
        var ch = this.s.charAt(this.i);
        if (ch === quote) {
          if (this.s.charAt(this.i + 1) === quote) { out += quote; this.i += 2; continue; }
          this.i++;
          return { t: 'lit', v: out };
        }
        out += ch;
        this.i++;
      }
      throw new Error('XPath: unterminated string literal in ' + this.s);
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(this.s.charAt(this.i + 1)))) {
      var start = this.i;
      while (/[0-9.]/.test(this.peek())) this.i++;
      return { t: 'num', v: parseFloat(this.s.slice(start, this.i)) };
    }
    // function call or path
    var save = this.i;
    var name = this.readName();
    if (name && FUNCTIONS[name]) {
      var afterName = this.i;
      this.skipWs();
      if (this.peek() === '(') {
        this.i++;
        var args = [];
        this.skipWs();
        if (this.peek() !== ')') {
          args.push(this.parseOr());
          this.skipWs();
          while (this.peek() === ',') {
            this.i++;
            args.push(this.parseOr());
            this.skipWs();
          }
        }
        if (this.peek() !== ')') throw new Error('XPath: expected ) after ' + name + '( in ' + this.s);
        this.i++;
        return { t: 'func', name: name, args: args };
      }
      this.i = afterName;
    }
    this.i = save;
    return this.parsePath();
  };

  ExprParser.prototype.parsePath = function () {
    var steps = [];
    var absolute = false;
    var descNext = false;
    this.skipWs();
    if (this.peek() === '/') {
      absolute = true;
      this.i++;
      if (this.peek() === '/') { descNext = true; this.i++; }
      var save = this.i;
      this.skipWs();
      if (this.i >= this.s.length || this.peek() === ')' || this.peek() === ']' || this.peek() === ',') {
        return { t: 'path', absolute: true, rootOnly: true, steps: [] };
      }
      this.i = save;
    }
    while (true) {
      var step = this.parseStep();
      step.desc = descNext;
      descNext = false;
      steps.push(step);
      if (this.peek() === '/') {
        this.i++;
        if (this.peek() === '/') { descNext = true; this.i++; }
        continue;
      }
      break;
    }
    return { t: 'path', absolute: absolute, steps: steps };
  };

  ExprParser.prototype.parseStep = function () {
    this.skipWs();
    if (this.s.startsWith('..', this.i)) {
      this.i += 2;
      return { axis: 'parent', test: null, preds: [] };
    }
    if (this.peek() === '.' && this.s.charAt(this.i + 1) !== '.') {
      this.i++;
      return { axis: 'self', test: null, preds: [] };
    }
    var axis = 'child';
    if (this.peek() === '@') { axis = 'attribute'; this.i++; }
    var test;
    if (this.peek() === '*') {
      this.i++;
      test = { kind: 'wildcard' };
    } else {
      var name = this.readName();
      if (!name) throw new Error('XPath: expected node test at ' + this.i + ' in ' + this.s);
      if ((name === 'text' || name === 'node') && this.peek() === '(') {
        this.i++;
        this.skipWs();
        if (this.peek() !== ')') throw new Error('XPath: expected ) in ' + name + '()');
        this.i++;
        test = { kind: name };
      } else {
        test = { kind: 'name', name: name };
      }
    }
    var preds = [];
    while (true) {
      this.skipWs();
      if (this.peek() !== '[') break;
      this.i++;
      preds.push(this.parseOr());
      this.skipWs();
      if (this.peek() !== ']') throw new Error('XPath: expected ] in ' + this.s);
      this.i++;
    }
    return { axis: axis, test: test, preds: preds };
  };

  function parseExpression(str) {
    var p = new ExprParser(str);
    var ast = p.parseOr();
    p.skipWs();
    if (p.i < p.s.length) throw new Error('XPath: trailing characters in expression: ' + str);
    return ast;
  }

  // ------------------------------------------------------------ XPath eval

  function toBool(v) {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'number') return v !== 0 && !isNaN(v);
    return !!v;
  }

  function toStr(v) {
    if (Array.isArray(v)) return v.length ? stringValue(v[0]) : '';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  }

  function toNum(v) {
    if (Array.isArray(v)) return v.length ? Number(stringValue(v[0])) : NaN;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return Number(v);
  }

  function compareVals(op, l, r) {
    if (op === '=' || op === '!=') {
      var want = op === '=';
      if (Array.isArray(l) || Array.isArray(r)) {
        if (typeof l === 'boolean' || typeof r === 'boolean') {
          return (toBool(l) === toBool(r)) === want;
        }
        var ls = Array.isArray(l) ? l : null;
        var rs = Array.isArray(r) ? r : null;
        var other = ls ? r : l;
        var set = ls || rs;
        if (ls && rs) {
          for (var a = 0; a < ls.length; a++) {
            for (var b = 0; b < rs.length; b++) {
              if (stringValue(ls[a]) === stringValue(rs[b])) return want;
            }
          }
          return !want;
        }
        for (var i = 0; i < set.length; i++) {
          var sv = stringValue(set[i]);
          var eq = typeof other === 'number' ? Number(sv) === other : sv === toStr(other);
          if (eq) return want;
        }
        return !want;
      }
      if (typeof l === 'number' || typeof r === 'number') {
        return (toNum(l) === toNum(r)) === want;
      }
      return (toStr(l) === toStr(r)) === want;
    }
    // relational: numeric, node-set means "any node satisfying"
    var rn = toNum(r);
    if (Array.isArray(l)) {
      for (var x = 0; x < l.length; x++) {
        if (relCmp(op, Number(stringValue(l[x])), rn)) return true;
      }
      return false;
    }
    var ln = toNum(l);
    if (Array.isArray(r)) {
      for (var y = 0; y < r.length; y++) {
        if (relCmp(op, ln, Number(stringValue(r[y])))) return true;
      }
      return false;
    }
    return relCmp(op, ln, rn);
  }

  function relCmp(op, a, b) {
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
    if (op === '>') return a > b;
    if (op === '>=') return a >= b;
    return false;
  }

  function expandDescOrSelf(nodes) {
    var out = [];
    var seen = new Set();
    function visit(nd) {
      if (seen.has(nd)) return;
      seen.add(nd);
      out.push(nd);
      for (var i = 0; i < nd.children.length; i++) visit(nd.children[i]);
    }
    for (var i = 0; i < nodes.length; i++) visit(nodes[i]);
    return out;
  }

  function nodeMatchesTest(node, test) {
    if (!test) return true;
    if (test.kind === 'wildcard') return node.type === 'element';
    if (test.kind === 'name') return node.type === 'element' && node.name === test.name;
    if (test.kind === 'text') return node.type === 'text';
    if (test.kind === 'node') return node.type === 'element' || node.type === 'text';
    return false;
  }

  function applyStep(base, step) {
    var out = [];
    var i, j;
    if (step.axis === 'self') {
      return base.slice();
    }
    if (step.axis === 'parent') {
      var seen = new Set();
      for (i = 0; i < base.length; i++) {
        var par = base[i].parent;
        if (par && !seen.has(par)) { seen.add(par); out.push(par); }
      }
      return out;
    }
    if (step.axis === 'attribute') {
      for (i = 0; i < base.length; i++) {
        if (base[i].type !== 'element') continue;
        for (j = 0; j < base[i].attrs.length; j++) {
          var at = base[i].attrs[j];
          if (!step.test || step.test.kind === 'wildcard' || at.name === step.test.name) out.push(at);
        }
      }
      return out;
    }
    // child axis
    for (i = 0; i < base.length; i++) {
      for (j = 0; j < base[i].children.length; j++) {
        if (nodeMatchesTest(base[i].children[j], step.test)) out.push(base[i].children[j]);
      }
    }
    return out;
  }

  function applyPred(list, predAst) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var ctx = { node: list[i], pos: i + 1, size: list.length };
      var v = evalExpr(predAst, ctx);
      if (typeof v === 'number') {
        if (i + 1 === v) out.push(list[i]);
      } else if (toBool(v)) {
        out.push(list[i]);
      }
    }
    return out;
  }

  function evalPath(ast, ctx) {
    if (ast.rootOnly) return [rootOf(ctx.node)];
    var groups = [ast.absolute ? [rootOf(ctx.node)] : [ctx.node]];
    for (var s = 0; s < ast.steps.length; s++) {
      var step = ast.steps[s];
      var next = [];
      for (var g = 0; g < groups.length; g++) {
        var base = step.desc ? expandDescOrSelf(groups[g]) : groups[g];
        var res = applyStep(base, step);
        for (var p = 0; p < step.preds.length; p++) res = applyPred(res, step.preds[p]);
        if (res.length) next.push(res);
      }
      groups = next;
      if (!groups.length) break;
    }
    var out = [];
    var seen = new Set();
    for (var a = 0; a < groups.length; a++) {
      for (var b = 0; b < groups[a].length; b++) {
        if (!seen.has(groups[a][b])) { seen.add(groups[a][b]); out.push(groups[a][b]); }
      }
    }
    return out;
  }

  function evalExpr(ast, ctx) {
    switch (ast.t) {
      case 'lit': return ast.v;
      case 'num': return ast.v;
      case 'path': return evalPath(ast, ctx);
      case 'or': return toBool(evalExpr(ast.l, ctx)) || toBool(evalExpr(ast.r, ctx));
      case 'and': return toBool(evalExpr(ast.l, ctx)) && toBool(evalExpr(ast.r, ctx));
      case 'cmp': return compareVals(ast.op, evalExpr(ast.l, ctx), evalExpr(ast.r, ctx));
      case 'func': return evalFunc(ast, ctx);
    }
    throw new Error('XPath: unknown expression node ' + ast.t);
  }

  function evalFunc(ast, ctx) {
    var args = ast.args;
    function argStr(idx) { return toStr(evalExpr(args[idx], ctx)); }
    switch (ast.name) {
      case 'position': return ctx.pos;
      case 'last': return ctx.size;
      case 'true': return true;
      case 'false': return false;
      case 'count': {
        var v = evalExpr(args[0], ctx);
        return Array.isArray(v) ? v.length : 0;
      }
      case 'name': {
        if (!args.length) return ctx.node.name || '';
        var nv = evalExpr(args[0], ctx);
        return Array.isArray(nv) && nv.length ? (nv[0].name || '') : '';
      }
      case 'concat': {
        var parts = [];
        for (var i = 0; i < args.length; i++) parts.push(argStr(i));
        return parts.join('');
      }
      case 'contains': return argStr(0).indexOf(argStr(1)) !== -1;
      case 'starts-with': return argStr(0).indexOf(argStr(1)) === 0;
      case 'not': return !toBool(evalExpr(args[0], ctx));
      case 'string': {
        if (!args.length) return stringValue(ctx.node);
        return toStr(evalExpr(args[0], ctx));
      }
      case 'normalize-space': {
        var s = args.length ? argStr(0) : stringValue(ctx.node);
        return s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      }
    }
    throw new Error('XPath: unsupported function ' + ast.name);
  }

  function evalSelect(str, ctx) {
    var ast = parseExpression(str);
    if (ast.t === 'path') return evalPath(ast, ctx);
    var v = evalExpr(ast, ctx);
    return Array.isArray(v) ? v : [];
  }

  function evalToString(str, ctx) {
    return toStr(evalExpr(parseExpression(str), ctx));
  }

  function evalToBool(str, ctx) {
    return toBool(evalExpr(parseExpression(str), ctx));
  }

  // ------------------------------------------------------------ XSLT engine

  function isXSL(el) {
    return el && el.type === 'element' && (el.nsURI === XSLT_NS || el.prefix === 'xsl');
  }

  // Stylesheets ignore whitespace-only text nodes everywhere except
  // inside xsl:text. This is the standard XSLT stylesheet rule.
  function stripStylesheetWhitespace(node) {
    var kept = [];
    for (var i = 0; i < node.children.length; i++) {
      var ch = node.children[i];
      if (ch.type === 'text' && /^\s*$/.test(ch.value)) {
        if (!(node.type === 'element' && isXSL(node) && node.local === 'text')) continue;
      }
      stripStylesheetWhitespace(ch);
      kept.push(ch);
    }
    node.children = kept;
  }

  // Attribute value templates: {expr} is replaced by the string value of
  // the expression; {{ and }} are literal braces.
  function evalAVT(value, ctx) {
    var out = '';
    var i = 0;
    while (i < value.length) {
      var c = value.charAt(i);
      if (c === '{') {
        if (value.charAt(i + 1) === '{') { out += '{'; i += 2; continue; }
        // find the closing brace, ignoring braces inside quotes/brackets
        var depth = 0;
        var quote = null;
        var j = i + 1;
        for (; j < value.length; j++) {
          var ch = value.charAt(j);
          if (quote) { if (ch === quote) quote = null; continue; }
          if (ch === "'" || ch === '"') { quote = ch; continue; }
          if (ch === '[') depth++;
          else if (ch === ']') depth--;
          else if (ch === '}' && depth === 0) break;
        }
        if (j >= value.length) { out += c; i++; continue; }
        out += evalToString(value.slice(i + 1, j), ctx);
        i = j + 1;
      } else if (c === '}' && value.charAt(i + 1) === '}') {
        out += '}';
        i += 2;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ match patterns

  function parsePattern(pat) {
    var trimmed = pat.replace(/^\s+|\s+$/g, '');
    if (trimmed === '/') return { rootOnly: true, steps: [], absolute: true };
    var p = new ExprParser(trimmed);
    var ast = p.parsePath();
    p.skipWs();
    if (p.i < p.s.length) throw new Error('XSLT: unsupported match pattern: ' + pat);
    return ast;
  }

  function patternPriority(patStr, ast) {
    if (patStr.indexOf('[') !== -1) return 0.5;
    if (ast.rootOnly) return 0.5;
    if (ast.absolute || ast.steps.length > 1) return 0.5;
    var st = ast.steps[0];
    if (st && st.test && st.test.kind === 'name') return 0;
    return -0.5; // wildcards and other bare node tests
  }

  function stepTestMatch(node, step) {
    if (step.axis === 'attribute') {
      if (node.type !== 'attribute') return false;
      return !step.test || step.test.kind === 'wildcard' || node.name === step.test.name;
    }
    if (step.axis === 'self') return true;
    if (node.type !== 'element') return false;
    if (!step.test) return true;
    if (step.test.kind === 'wildcard' || step.test.kind === 'node') return true;
    if (step.test.kind === 'name') return node.name === step.test.name;
    return false;
  }

  function matchFrom(node, steps, k, ast) {
    if (!node || !stepTestMatch(node, steps[k])) return false;
    if (k === 0) {
      if (steps[0].desc) return true; // //name at the front: matches anywhere
      if (ast.absolute) return !!node.parent && node.parent.type === 'document';
      return true;
    }
    if (steps[k].desc) {
      var anc = node.parent;
      while (anc) {
        if (matchFrom(anc, steps, k - 1, ast)) return true;
        anc = anc.parent;
      }
      return false;
    }
    return matchFrom(node.parent, steps, k - 1, ast);
  }

  function matchPattern(node, tpl) {
    if (tpl.ast.rootOnly) return node.type === 'document';
    return matchFrom(node, tpl.ast.steps, tpl.ast.steps.length - 1, tpl.ast);
  }

  // ------------------------------------------------------------ processing

  var TEMPLATES = [];
  var OUTPUT_METHOD = 'xml';

  function findTemplate(node) {
    var best = null;
    for (var i = 0; i < TEMPLATES.length; i++) {
      var tpl = TEMPLATES[i];
      if (matchPattern(node, tpl)) {
        // >= so that on a priority tie the later template wins
        if (!best || tpl.prio >= best.prio) best = tpl;
      }
    }
    return best;
  }

  function makeText(value) {
    var t = makeNode('text');
    t.value = value;
    return t;
  }

  function processNode(node, ctx) {
    var tpl = findTemplate(node);
    if (tpl) return execNodes(tpl.body, ctx);
    // built-in templates: elements/document recurse, text and
    // attribute nodes copy their value through
    if (node.type === 'text') return [makeText(node.value)];
    if (node.type === 'attribute') return [makeText(node.value)];
    var out = [];
    var kids = node.children;
    for (var i = 0; i < kids.length; i++) {
      var sub = processNode(kids[i], { node: kids[i], pos: i + 1, size: kids.length });
      for (var j = 0; j < sub.length; j++) out.push(sub[j]);
    }
    return out;
  }

  function execNodes(nodes, ctx) {
    var out = [];
    var i, j;
    for (i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (nd.type === 'text') {
        if (nd.value) out.push(makeText(nd.value));
        continue;
      }
      if (nd.type !== 'element') continue;

      if (!isXSL(nd)) {
        // literal result element
        var el = makeNode('element');
        el.name = nd.name;
        el.prefix = nd.prefix;
        el.local = nd.local;
        for (j = 0; j < nd.attrs.length; j++) {
          var at = nd.attrs[j];
          if (at.name === 'xmlns' || at.prefix === 'xmlns') continue;
          var rat = makeNode('attribute');
          rat.name = at.name;
          rat.prefix = at.prefix;
          rat.local = at.local;
          rat.value = evalAVT(at.value, ctx);
          rat.parent = el;
          el.attrs.push(rat);
        }
        var kids = execNodes(nd.children, ctx);
        for (j = 0; j < kids.length; j++) {
          // attributes produced inside (e.g. via copy-of of @x) belong
          // to the element itself, not to its children
          if (kids[j].type === 'attribute') {
            kids[j].parent = el;
            el.attrs.push(kids[j]);
          } else {
            kids[j].parent = el;
            el.children.push(kids[j]);
          }
        }
        out.push(el);
        continue;
      }

      switch (nd.local) {
        case 'value-of': {
          var sel = getAttr(nd, 'select');
          out.push(makeText(sel ? evalToString(sel, ctx) : ''));
          break;
        }
        case 'apply-templates': {
          var aSel = getAttr(nd, 'select');
          var list = aSel ? evalSelect(aSel, ctx) : ctx.node.children.slice();
          for (j = 0; j < list.length; j++) {
            var sub = processNode(list[j], { node: list[j], pos: j + 1, size: list.length });
            for (var q = 0; q < sub.length; q++) out.push(sub[q]);
          }
          break;
        }
        case 'for-each': {
          var fList = evalSelect(getAttr(nd, 'select') || '', ctx);
          for (j = 0; j < fList.length; j++) {
            var fSub = execNodes(nd.children, { node: fList[j], pos: j + 1, size: fList.length });
            for (var f = 0; f < fSub.length; f++) out.push(fSub[f]);
          }
          break;
        }
        case 'if': {
          if (evalToBool(getAttr(nd, 'test') || '', ctx)) {
            var iSub = execNodes(nd.children, ctx);
            for (j = 0; j < iSub.length; j++) out.push(iSub[j]);
          }
          break;
        }
        case 'choose': {
          var done = false;
          for (j = 0; j < nd.children.length && !done; j++) {
            var ch = nd.children[j];
            if (ch.type !== 'element' || !isXSL(ch)) continue;
            if (ch.local === 'when' && evalToBool(getAttr(ch, 'test') || '', ctx)) {
              var wSub = execNodes(ch.children, ctx);
              for (var w = 0; w < wSub.length; w++) out.push(wSub[w]);
              done = true;
            } else if (ch.local === 'otherwise') {
              var oSub = execNodes(ch.children, ctx);
              for (var o = 0; o < oSub.length; o++) out.push(oSub[o]);
              done = true;
            }
          }
          break;
        }
        case 'text': {
          out.push(makeText(stringValue(nd)));
          break;
        }
        case 'copy-of': {
          var cList = evalSelect(getAttr(nd, 'select') || '', ctx);
          for (j = 0; j < cList.length; j++) {
            var cloned = cloneNode(cList[j]);
            if (Array.isArray(cloned)) {
              for (var c = 0; c < cloned.length; c++) out.push(cloned[c]);
            } else {
              out.push(cloned);
            }
          }
          break;
        }
        default:
          // Instructions outside the supported subset are ignored.
          break;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ serializer

  function escapeText(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  var HTML_VOID = {
    area: true, base: true, br: true, col: true, embed: true, hr: true,
    img: true, input: true, link: true, meta: true, param: true,
    source: true, track: true, wbr: true
  };

  function serializeNodes(nodes, method) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) out += serializeNode(nodes[i], method);
    return out;
  }

  function serializeNode(node, method) {
    if (node.type === 'text') {
      return method === 'text' ? (node.value || '') : escapeText(node.value || '');
    }
    if (node.type === 'attribute') {
      return method === 'text' ? (node.value || '') : escapeText(node.value || '');
    }
    if (node.type === 'document') return serializeNodes(node.children, method);
    // element
    if (method === 'text') {
      var t = '';
      for (var i = 0; i < node.children.length; i++) t += serializeNode(node.children[i], method);
      return t;
    }
    var open = '<' + node.name;
    for (var a = 0; a < node.attrs.length; a++) {
      open += ' ' + node.attrs[a].name + '="' + escapeAttr(node.attrs[a].value || '') + '"';
    }
    if (!node.children.length) {
      if (method === 'html') {
        return HTML_VOID[node.name.toLowerCase()] ? open + '>' : open + '></' + node.name + '>';
      }
      return open + '/>';
    }
    return open + '>' + serializeNodes(node.children, method) + '</' + node.name + '>';
  }

  // ------------------------------------------------------------ entry point

  function transform(xmlString, xsltString) {
    var srcDoc = parseXML(xmlString);
    var ssDoc = parseXML(xsltString);
    var ssRoot = null;
    for (var i = 0; i < ssDoc.children.length; i++) {
      var ch = ssDoc.children[i];
      if (ch.type === 'element' && isXSL(ch) && (ch.local === 'stylesheet' || ch.local === 'transform')) {
        ssRoot = ch;
        break;
      }
    }
    if (!ssRoot) throw new Error('XSLT: no xsl:stylesheet or xsl:transform root element found');

    stripStylesheetWhitespace(ssRoot);

    TEMPLATES = [];
    OUTPUT_METHOD = 'xml';
    for (i = 0; i < ssRoot.children.length; i++) {
      var top = ssRoot.children[i];
      if (top.type !== 'element' || !isXSL(top)) continue;
      if (top.local === 'output') {
        var m = (getAttr(top, 'method') || 'xml').toLowerCase();
        if (m === 'xml' || m === 'html' || m === 'text') OUTPUT_METHOD = m;
      } else if (top.local === 'template') {
        var match = getAttr(top, 'match');
        if (match) {
          var ast = parsePattern(match);
          TEMPLATES.push({ pattern: match, ast: ast, prio: patternPriority(match, ast), body: top.children });
        }
      }
    }

    var result = processNode(srcDoc, { node: srcDoc, pos: 1, size: 1 });
    return serializeNodes(result, OUTPUT_METHOD);
  }

  var api = { transform: transform, parseXML: parseXML };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SparkXSLT = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
