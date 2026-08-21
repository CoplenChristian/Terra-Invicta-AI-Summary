const {
  renderCompactSnapshotMarkdown,
  renderFullMarkdownReport,
  renderThreatsMarkdown,
  renderWarRoomMarkdown
} = require('../shared/markdownExports.mjs');

class ExportGenerator {
  generateCompactSnapshot(filteredData) {
    return renderCompactSnapshotMarkdown(filteredData);
  }

  generateFullMarkdownReport(filteredData) {
    return renderFullMarkdownReport(filteredData);
  }

  generateThreatsMarkdown(filteredData, options) {
    return renderThreatsMarkdown(filteredData, options);
  }

  generateWarRoomMarkdown(filteredData, options) {
    return renderWarRoomMarkdown(filteredData, options);
  }
}

module.exports = new ExportGenerator();
