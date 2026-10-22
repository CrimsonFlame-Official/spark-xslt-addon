'use strict';

// Small demo: transforms books.xml with books.xsl and prints the result.
// Run from anywhere:  node examples/demo.js

var fs = require('fs');
var path = require('path');
var xslt = require('../src/xslt.js');

var xml = fs.readFileSync(path.join(__dirname, 'books.xml'), 'utf8');
var xsl = fs.readFileSync(path.join(__dirname, 'books.xsl'), 'utf8');

console.log(xslt.transform(xml, xsl));
