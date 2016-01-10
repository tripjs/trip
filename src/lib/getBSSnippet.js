import {version} from 'browser-sync/package.json';

export default function getBSSnippet(port) {
  return (
    '\n<!-- browsersync snippet -->' +
    '\n<script>' +
    `\ndocument.write('<script async src="http://' + location.hostname + ':${port}/browser-sync/browser-sync-client.${version}.js"><\\/script>');` +
    '\n</script>' +
    '\n<!-- end browsersync snippet -->\n'
  );
}
