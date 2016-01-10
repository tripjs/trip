const css = (`
  /* reset */
  #trip-build-error-report,
  #trip-build-error-report * {
    position: static !important;
    border: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    font: bold 18px/1 Menlo, Consolas, monospace !important;
    letter-spacing: 0 !important;
    word-spacing: 0 !important;
    outline: none !important;
    -webkit-font-smoothing:antialiased !important;
    -moz-osx-font-smoothing:grayscale !important;
  }
  #trip-build-error-report {
    position: fixed !important;
    top: 0 !important;
    width: 100% !important;
    background: rgba(0,0,0,0.9) !important;
  }
  #trip-build-error-report>pre {
    display: block !important;
    margin: 20px !important;
  }
`);

export default function getErrorSnippet(error) {
  if (error) {
    let html = '<div id="trip-build-error-report">';

    html += `<pre><span style="color:red">${escape(error.message)}</span>`;

    if (error && error.__CodeError) {
      html += `\n\n${error.htmlExcerpt}\n`;
    }

    html += `</pre><style>${css}</style></div>`;

    return html;
  }

  return '';
}

function escape(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
