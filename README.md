# XSLT add-on for Spark

This is the official XSLT add-on for the Spark browser. XSLT is legacy tech
that the big browsers are dropping, and Spark never had it in the core. This
add-on brings it back as an opt-in extra: install it if you run into older
XML sites that rely on XSLT, ignore it if you don't. The core browser stays
lean either way.

It's one self-contained JavaScript file with its own XML parser, XPath
evaluator, and XSLT processor. No dependencies. It runs in Node and in a
browser from a plain script tag.

## What's in here

- `addon.json` - the Spark add-on manifest.
- `src/xslt.js` - the whole processor. Public API:
  - `transform(xmlString, xsltString)` returns the transformed output as a string.
  - `parseXML(xmlString)` returns the parsed document node tree.
  - In a browser it exposes `window.SparkXSLT`; in Node it's a CommonJS module.
- `examples/` - a worked example: `books.xml` + `books.xsl` produces
  `books.html`. Run `node examples/demo.js` to see it happen.
- `test/test.js` - the test suite.

## Running the tests

```
node test/test.js
```

Every case runs a real transform and compares the output exactly. Exit code
is 1 if anything fails.

## What it covers

XSLT side:

- `xsl:stylesheet` / `xsl:transform` root (any prefix bound to the XSLT
  namespace works, not just `xsl:`)
- `xsl:template` with match patterns: `/`, element names, `*`, `a/b`,
  `//name`, `@attr`. Simple priority: patterns with predicates or multiple
  steps beat single names, single names beat `*`, and on a tie the later
  template wins.
- `xsl:apply-templates` with optional `select`
- `xsl:value-of`, `xsl:for-each`, `xsl:if`,
  `xsl:choose` / `xsl:when` / `xsl:otherwise`
- `xsl:text`, `xsl:copy-of` (deep copy)
- Literal result elements and attributes, including attribute value
  templates like `href="{@url}"`
- `xsl:output` with method `xml`, `html`, or `text`
- The built-in default templates: elements recurse, text and attribute
  values are copied through.

XPath side (in `select` / `test` attributes and `{...}` templates):

- Paths with `/`, `//`, `.`, `..`, `@attr`, `@*`, `*`, element names,
  `text()`, `node()`
- Predicates: `[n]`, `[@attr='value']`, `[child='value']`, `[child]`,
  and other boolean/numeric expressions
- Comparisons `= != < <= > >=`, plus `and` / `or`
- Functions: `position()`, `last()`, `count()`, `name()`, `concat()`,
  `contains()`, `starts-with()`, `not()`, `string()`, `normalize-space()`,
  `true()`, `false()`

XML parser: elements, attributes, text, CDATA sections, comments and
processing instructions (skipped), entity and character references, and
namespace prefix resolution.

## What it does NOT do

This is an honestly scoped subset of XSLT 1.0, not a full implementation.
Not supported:

- `xsl:sort`, `xsl:variable` / `xsl:param`, `xsl:call-template`,
  `xsl:with-param`, named templates in general
- Template modes (`mode` attribute), `xsl:import` / `xsl:include`,
  multiple files
- `xsl:number`, `xsl:key` and the `key()` function, `id()` patterns
- Full XPath: no extra axes (`ancestor::`, `following-sibling::`, ...),
  no `union` (`a | b`), no arithmetic, no variables
- `xsl:output` options beyond `method` (no indent control, no doctype)
- Whitespace control with `xsl:strip-space` / `xsl:preserve-space`
  (source documents keep their text as-is)
- DOCTYPE internal subsets in parsed XML

Stylesheets that stick to the covered list above work. Anything reaching
for the unsupported list will come out wrong or be ignored quietly, so check
the list before wondering why a fancy stylesheet misbehaves.

## Status

Spark doesn't have an add-on loader yet, so for now this package is used
through its API (Node, or a script tag exposing `SparkXSLT`). The manifest
is ready, and the package is ready to plug in as soon as the loader exists.
