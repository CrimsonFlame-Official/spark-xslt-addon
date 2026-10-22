<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html"/>
  <xsl:template match="/">
    <html>
      <head><title>Book Catalog</title></head>
      <body>
        <h1>Book Catalog</h1>
        <table>
          <tr><th>Title</th><th>Author</th><th>Year</th></tr>
          <xsl:for-each select="catalog/book">
            <tr id="{@id}">
              <td><xsl:value-of select="title"/></td>
              <td><xsl:value-of select="author"/></td>
              <td><xsl:value-of select="year"/></td>
            </tr>
          </xsl:for-each>
        </table>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
