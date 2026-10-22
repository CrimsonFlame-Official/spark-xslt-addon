'use strict';

// Plain-Node test script for the Spark XSLT add-on. No framework:
// each case runs a real transform and compares the output exactly.
// Run:  node test/test.js     (exit code 1 if anything fails)

var fs = require('fs');
var path = require('path');
var xslt = require('../src/xslt.js');

var passed = 0;
var failed = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log('ok   - ' + name);
  } else {
    failed++;
    console.log('FAIL - ' + name);
    console.log('  expected: ' + JSON.stringify(expected));
    console.log('  actual:   ' + JSON.stringify(actual));
  }
}

function run(name, xml, xsl, expected) {
  var actual;
  try {
    actual = xslt.transform(xml, xsl);
  } catch (e) {
    failed++;
    console.log('FAIL - ' + name + ' (threw: ' + e.message + ')');
    return;
  }
  check(name, actual, expected);
}

var HEAD = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">';
var FOOT = '</xsl:stylesheet>';

// 1. xsl:value-of
run('value-of',
  '<root><title>Hello</title></root>',
  HEAD + '<xsl:template match="/"><out><xsl:value-of select="root/title"/></out></xsl:template>' + FOOT,
  '<out>Hello</out>');

// 2. xsl:for-each over repeating elements
run('for-each',
  '<books><book><title>A</title></book><book><title>B</title></book><book><title>C</title></book></books>',
  HEAD + '<xsl:template match="/"><list><xsl:for-each select="books/book"><item><xsl:value-of select="title"/></item></xsl:for-each></list></xsl:template>' + FOOT,
  '<list><item>A</item><item>B</item><item>C</item></list>');

// 3. xsl:if with a numeric comparison
run('if',
  '<root><item><name>Pen</name><price>25</price></item><item><name>Pad</name><price>5</price></item></root>',
  HEAD + '<xsl:template match="/"><div><xsl:for-each select="root/item"><p><xsl:value-of select="name"/><xsl:if test="price &gt; 10"> (expensive)</xsl:if></p></xsl:for-each></div></xsl:template>' + FOOT,
  '<div><p>Pen (expensive)</p><p>Pad</p></div>');

// 4. xsl:choose / when / otherwise, all three branches
run('choose',
  '<root><item><name>A</name><price>200</price></item><item><name>B</name><price>50</price></item><item><name>C</name><price>5</price></item></root>',
  HEAD + '<xsl:template match="/"><div><xsl:for-each select="root/item"><p><xsl:value-of select="name"/>: <xsl:choose><xsl:when test="price &gt; 100">high</xsl:when><xsl:when test="price &gt; 10">mid</xsl:when><xsl:otherwise>low</xsl:otherwise></xsl:choose></p></xsl:for-each></div></xsl:template>' + FOOT,
  '<div><p>A: high</p><p>B: mid</p><p>C: low</p></div>');

// 5. xsl:apply-templates with several templates
run('apply-templates',
  '<catalog><book><title>X</title><author>Y</author></book></catalog>',
  HEAD +
  '<xsl:template match="/"><html><body><xsl:apply-templates select="catalog/book"/></body></html></xsl:template>' +
  '<xsl:template match="book"><div><xsl:apply-templates/></div></xsl:template>' +
  '<xsl:template match="title"><h1><xsl:value-of select="."/></h1></xsl:template>' +
  '<xsl:template match="author"><span><xsl:value-of select="."/></span></xsl:template>' +
  FOOT,
  '<html><body><div><h1>X</h1><span>Y</span></div></body></html>');

// 6. attribute value templates
run('attribute value templates',
  '<links><link url="https://example.com">Site</link><link url="https://example.org">Other</link></links>',
  HEAD + '<xsl:template match="/"><page><xsl:for-each select="links/link"><a href="{@url}"><xsl:value-of select="."/></a></xsl:for-each></page></xsl:template>' + FOOT,
  '<page><a href="https://example.com">Site</a><a href="https://example.org">Other</a></page>');

// 7. predicates: [@attr='value'], [n], [child='value']
run('predicates',
  '<books><book id="b1"><title>A</title><cat>fiction</cat></book><book id="b2"><title>B</title><cat>tech</cat></book><book id="b3"><title>C</title><cat>fiction</cat></book></books>',
  HEAD + '<xsl:template match="/"><out><first><xsl:value-of select="books/book[@id=\'b2\']/title"/></first><second><xsl:value-of select="books/book[2]/title"/></second><fic><xsl:value-of select="books/book[cat=\'fiction\']/title"/></fic></out></xsl:template>' + FOOT,
  '<out><first>B</first><second>B</second><fic>A</fic></out>');

// 8. text output mode with xsl:text line breaks
run('text output mode',
  '<books><book><title>A</title></book><book><title>B</title></book></books>',
  HEAD + '<xsl:output method="text"/><xsl:template match="/"><xsl:for-each select="books/book"><xsl:value-of select="title"/><xsl:text>&#10;</xsl:text></xsl:for-each></xsl:template>' + FOOT,
  'A\nB\n');

// 9. xsl:copy-of deep-copies the selected nodes
run('copy-of',
  '<root><item a="1"><b>z</b></item></root>',
  HEAD + '<xsl:template match="/"><out><xsl:copy-of select="root/item"/></out></xsl:template>' + FOOT,
  '<out><item a="1"><b>z</b></item></out>');

// 10. XPath functions: count, position, last, concat, normalize-space, name, //
run('xpath functions',
  '<books><book><title>  A Tale  </title></book><book><title>B</title></book></books>',
  HEAD + '<xsl:template match="/"><out><n><xsl:value-of select="count(//book)"/></n><xsl:for-each select="books/book"><p><xsl:value-of select="concat(position(), \'/\', last(), \': \', normalize-space(title))"/></p></xsl:for-each><nm><xsl:value-of select="name(books)"/></nm></out></xsl:template>' + FOOT,
  '<out><n>2</n><p>1/2: A Tale</p><p>2/2: B</p><nm>books</nm></out>');

// 11. contains / starts-with / not inside xsl:if
run('string functions in tests',
  '<root><file>report.pdf</file><file>notes.txt</file></root>',
  HEAD + '<xsl:template match="/"><out><xsl:for-each select="root/file"><xsl:if test="contains(., \'.pdf\')"><pdf><xsl:value-of select="."/></pdf></xsl:if><xsl:if test="starts-with(., \'notes\')"><note><xsl:value-of select="."/></note></xsl:if></xsl:for-each><xsl:if test="not(root/missing)"><ok/></xsl:if></out></xsl:template>' + FOOT,
  '<out><pdf>report.pdf</pdf><note>notes.txt</note><ok/></out>');

// 12. template priority: a named pattern beats *
run('template priority',
  '<root><item>plain</item></root>',
  HEAD +
  '<xsl:template match="/"><out><xsl:apply-templates select="root/item"/></out></xsl:template>' +
  '<xsl:template match="*"><generic/></xsl:template>' +
  '<xsl:template match="item"><specific><xsl:value-of select="."/></specific></xsl:template>' +
  FOOT,
  '<out><specific>plain</specific></out>');

// 13. built-in templates: unstyled elements fall back to text copy/recursion
run('built-in templates',
  '<root><a>one <b>two</b> three</a></root>',
  HEAD + '<xsl:template match="/"><out><xsl:apply-templates select="root/a"/></out></xsl:template>' + FOOT,
  '<out>one two three</out>');

// 14. worked example from examples/ (books.xml + books.xsl -> books.html)
(function () {
  var dir = path.join(__dirname, '..', 'examples');
  var xml = fs.readFileSync(path.join(dir, 'books.xml'), 'utf8');
  var xsl = fs.readFileSync(path.join(dir, 'books.xsl'), 'utf8');
  var expected = fs.readFileSync(path.join(dir, 'books.html'), 'utf8').trim();
  var actual;
  try {
    actual = xslt.transform(xml, xsl).trim();
  } catch (e) {
    failed++;
    console.log('FAIL - examples/books (threw: ' + e.message + ')');
    return;
  }
  check('examples/books', actual, expected);
})();

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
