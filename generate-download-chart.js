#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Input file containing the historical data
const inputFile = "chatgpt-md-history.json";
// Output HTML file with the chart
const outputHtmlFile = "chatgpt-md-downloads-chart.html";

// Read and parse the JSON data
console.log(`Reading data from ${inputFile}...`);
if (!fs.existsSync(inputFile)) {
  console.error(`Error: File '${inputFile}' not found.`);
  process.exit(1);
}

const historicalData = JSON.parse(fs.readFileSync(inputFile, "utf8"));

// Process data for the chart
console.log(`Processing data for the chart...`);

// Convert the data into a chronologically ordered array
const dataPoints = Object.entries(historicalData)
  .map(([commitHash, entry]) => ({
    date: new Date(entry.date),
    downloads: entry.data.downloads || 0,
    versions: Object.entries(entry.data)
      .filter(([key]) => key !== "downloads" && key !== "updated")
      .reduce((acc, [version, count]) => {
        acc[version] = count;
        return acc;
      }, {}),
  }))
  .sort((a, b) => a.date - b.date); // Sort by date ascending

// Determine the current version for each data point
// Start with no version and update it when we find a new one
let currentVersion = null;
dataPoints.forEach((point) => {
  // Check if this data point has new versions
  const versions = Object.keys(point.versions);
  if (versions.length > 0) {
    // Find newest version using semver-like comparison
    const newestVersion = versions.sort((a, b) => {
      const aParts = a.split(".").map(Number);
      const bParts = b.split(".").map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return bVal - aVal;
      }
      return 0;
    })[0];

    // Update current version if this is newer
    if (!currentVersion || versions.includes(currentVersion)) {
      currentVersion = newestVersion;
    }
  }

  // Tag this data point with the current version
  point.currentVersion = currentVersion;
});

// Create arrays for chart data
const dates = dataPoints.map((point) => point.date.toISOString());
const downloadCounts = dataPoints.map((point) => point.downloads);
const oldestDate = dataPoints[0].date.getTime();
const newestDate = dataPoints[dataPoints.length - 1].date.getTime();

// Get version release points for annotations and dataset segmentation
const versionReleases = [];
const processedVersions = new Set();
const versionIndices = []; // To track where each version starts

dataPoints.forEach((point, index) => {
  const versions = Object.keys(point.versions);
  versions.forEach((version) => {
    if (!processedVersions.has(version)) {
      processedVersions.add(version);
      versionReleases.push({
        version,
        date: point.date,
        index,
        downloads: point.downloads,
      });
      versionIndices.push(index); // Mark this index as a version change point
    }
  });
});

// Generate unique colors for each version
function generateColors(count) {
  const colors = [];
  // Set of base colors (you can customize these)
  const baseColors = [
    "#0066cc", // blue
    "#cc0000", // red
    "#009900", // green
    "#9900cc", // purple
    "#ff9900", // orange
    "#00cccc", // teal
    "#cc0099", // pink
    "#666600", // olive
    "#ff0099", // magenta
    "#006666", // dark cyan
  ];

  for (let i = 0; i < count; i++) {
    colors.push(baseColors[i % baseColors.length]);
  }
  return colors;
}

const versionColors = generateColors(versionReleases.length);

// Break the data into segments by version
const datasets = [];
const derivativeData = [];

// Calculate rate of change (downloads per day)
for (let i = 1; i < downloadCounts.length; i++) {
  const daysDifference =
    (dataPoints[i].date - dataPoints[i - 1].date) / (1000 * 60 * 60 * 24); // Convert ms to days
  const downloadDifference = downloadCounts[i] - downloadCounts[i - 1];
  const rate = daysDifference > 0 ? downloadDifference / daysDifference : 0;
  derivativeData.push({
    x: dataPoints[i].date.toISOString(),
    y: Math.round(rate), // Round to integer
  });
}

// Calculate 7-day rolling average of the daily download rates
const rollingAverageData7Day = [];
const windowSize7Day = 7; // 7-day window

for (let i = 0; i < derivativeData.length; i++) {
  // Calculate the start index for the window (max of 0 or i - windowSize + 1)
  const startIdx = Math.max(0, i - windowSize7Day + 1);
  const windowValues = derivativeData
    .slice(startIdx, i + 1)
    .map((item) => item.y);

  // Calculate the average of values in the window
  const sum = windowValues.reduce((acc, val) => acc + val, 0);
  const avg = windowValues.length > 0 ? sum / windowValues.length : 0;

  rollingAverageData7Day.push({
    x: derivativeData[i].x,
    y: Math.round(avg), // Round to integer
  });
}

// Calculate 30-day rolling average
const rollingAverageData30Day = [];
const windowSize30Day = 30; // 30-day window

for (let i = 0; i < derivativeData.length; i++) {
  // Calculate the start index for the window (max of 0 or i - windowSize + 1)
  const startIdx = Math.max(0, i - windowSize30Day + 1);
  const windowValues = derivativeData
    .slice(startIdx, i + 1)
    .map((item) => item.y);

  // Calculate the average of values in the window
  const sum = windowValues.reduce((acc, val) => acc + val, 0);
  const avg = windowValues.length > 0 ? sum / windowValues.length : 0;

  rollingAverageData30Day.push({
    x: derivativeData[i].x,
    y: Math.round(avg), // Round to integer
  });
}

// Add datasets for downloads by version
for (let i = 0; i <= versionIndices.length; i++) {
  const startIdx = i === 0 ? 0 : versionIndices[i - 1];
  const endIdx = i === versionIndices.length ? dates.length : versionIndices[i];

  if (startIdx < endIdx) {
    const version = i === 0 ? "Initial" : versionReleases[i - 1].version;
    datasets.push({
      label: `v${version}`,
      data: Array(startIdx)
        .fill(null)
        .concat(downloadCounts.slice(startIdx, endIdx))
        .concat(Array(dates.length - endIdx).fill(null)),
      borderColor: versionColors[i % versionColors.length],
      backgroundColor: `${versionColors[i % versionColors.length]}22`,
      borderWidth: 3,
      pointRadius: 1, // Reduced dot size
      pointHoverRadius: 4, // Reduced hover dot size
      pointBackgroundColor: versionColors[i % versionColors.length],
      fill: true,
      tension: 0.1,
      yAxisID: "y", // Explicitly use the left axis
    });
  }
}

// Add the rate of change dataset
datasets.push({
  label: "Daily Growth Rate",
  data: derivativeData,
  borderColor: "#000000",
  backgroundColor: "rgba(0, 0, 0, 0.1)",
  borderWidth: 1.5,
  pointRadius: 0,
  pointHoverRadius: 4,
  fill: false,
  tension: 0.1,
  yAxisID: "y1", // Use the right axis
  borderDash: [2, 2], // Shorter dotted line
});

// Add the 7-day rolling average dataset
datasets.push({
  label: "7-Day Rolling Avg",
  data: rollingAverageData7Day,
  borderColor: "#FF5733", // Orange color
  backgroundColor: "rgba(255, 87, 51, 0.15)",
  borderWidth: 3,
  pointRadius: 0, // No points for cleaner look
  pointHoverRadius: 4,
  fill: true, // Add subtle fill
  tension: 0.1,
  yAxisID: "y1", // Use the right axis
  borderDash: [], // Solid line
});

// Add the 30-day rolling average dataset
datasets.push({
  label: "30-Day Rolling Avg",
  data: rollingAverageData30Day,
  borderColor: "#3498DB", // Blue color
  backgroundColor: "rgba(52, 152, 219, 0.15)",
  borderWidth: 3.5,
  pointRadius: 0, // No points for cleaner look
  pointHoverRadius: 4,
  fill: true, // Add subtle fill
  tension: 0.1,
  yAxisID: "y1", // Use the right axis
  borderDash: [8, 4], // Long dash
});

// Create the HTML content with the embedded chart
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>chatgpt-md Download Statistics</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
    <script src="https://cdn.jsdelivr.net/npm/nouislider@15.7.0/dist/nouislider.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/nouislider@15.7.0/dist/nouislider.min.css">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            padding: 20px;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-top: 0;
        }
        .chart-container {
            position: relative;
            height: 60vh;
            width: 100%;
        }
        .slider-container {
            margin: 20px 0;
            padding: 0 10px;
        }
        #time-slider {
            height: 10px;
            margin-top: 40px;
        }
        .time-display {
            display: flex;
            justify-content: space-between;
            margin-top: 15px;
        }
        .version-list {
            margin-top: 30px;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
        .version-tag {
            border-radius: 16px;
            padding: 5px 12px;
            font-size: 14px;
            color: white;
        }
        .stats {
            margin-top: 20px;
            display: flex;
            justify-content: space-around;
            background-color: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
        }
        .stat-box {
            text-align: center;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #0066cc;
        }
        .stat-label {
            font-size: 14px;
            color: #6c757d;
        }
        .noUi-connect {
            background: #0066cc;
        }
        .noUi-handle {
            border-radius: 50%;
            width: 20px !important;
            height: 20px !important;
            right: -10px !important;
            top: -5px !important;
            background: white;
            border: 1px solid #0066cc;
            box-shadow: 0 1px 5px rgba(0,0,0,0.2);
            cursor: grab;
        }
        .noUi-handle::before, .noUi-handle::after {
            display: none;
        }
        .version-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 8px;
            overflow: hidden;
        }
        .version-table th {
            background-color: #f8f9fa;
            padding: 12px 15px;
            text-align: left;
            font-weight: 600;
            font-size: 14px;
            color: #333;
            border-bottom: 2px solid #dee2e6;
        }
        .version-table td {
            padding: 10px 15px;
            border-bottom: 1px solid #e9ecef;
            font-size: 14px;
        }
        .version-table tr:last-child td {
            border-bottom: none;
        }
        .version-table tr:hover {
            background-color: #f8f9fa;
        }
        .version-color {
            display: inline-block;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            margin-right: 8px;
            vertical-align: middle;
        }
        .version-name {
            font-weight: 600;
            vertical-align: middle;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>chatgpt-md Download Statistics</h1>
        
        <div class="stats">
            <div class="stat-box">
                <div class="stat-value">${dataPoints.length}</div>
                <div class="stat-label">Data Points</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${versionReleases.length}</div>
                <div class="stat-label">Versions Released</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${downloadCounts[
                  downloadCounts.length - 1
                ].toLocaleString()}</div>
                <div class="stat-label">Latest Downloads</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">${new Date(
                  dataPoints[0].date,
                ).toLocaleDateString()} - ${new Date(
  dataPoints[dataPoints.length - 1].date,
).toLocaleDateString()}</div>
                <div class="stat-label">Date Range</div>
            </div>
        </div>
        
        <div class="chart-container">
            <canvas id="downloadsChart"></canvas>
        </div>
        
        <div class="slider-container">
            <div id="time-slider"></div>
            <div class="time-display">
                <div id="time-start"></div>
                <div id="time-end"></div>
            </div>
        </div>
        
        <table class="version-table">
            <thead>
                <tr>
                    <th>Version</th>
                    <th>Release Date</th>
                    <th>Downloads at Release</th>
                </tr>
            </thead>
            <tbody>
                ${versionReleases
                  .map(
                    (v, i) => `
                <tr>
                    <td>
                        <span class="version-color" style="background-color: ${
                          versionColors[i]
                        }"></span>
                        <span class="version-name">v${v.version}</span>
                    </td>
                    <td>${new Date(v.date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}</td>
                    <td>${v.downloads.toLocaleString()}</td>
                </tr>`,
                  )
                  .join("")}
            </tbody>
        </table>
    </div>

    <script>
        // Plugin to draw a dotted line pattern
        const verticalLinePlugin = {
            id: 'verticalLine',
            afterDraw: (chart) => {
                if (chart.tooltip._active && chart.tooltip._active.length) {
                    const activePoint = chart.tooltip._active[0];
                    const { ctx } = chart;
                    const { x } = activePoint.element.getCenterPoint();
                    const topY = chart.scales.y.top;
                    const bottomY = chart.scales.y.bottom;
                    
                    // Draw line
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, topY);
                    ctx.lineTo(x, bottomY);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = '#aaaaaa';
                    ctx.setLineDash([3, 3]);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        };
        
        // Chart data
        const dates = ${JSON.stringify(dates)};
        const downloads = ${JSON.stringify(downloadCounts)};
        const versionReleases = ${JSON.stringify(versionReleases)};
        const versionColors = ${JSON.stringify(versionColors)};
        const oldestDate = ${oldestDate};
        const newestDate = ${newestDate};
        
        // Create annotations for version releases
        const annotations = versionReleases.map((release, index) => ({
            type: 'line',
            xMin: dates[release.index],
            xMax: dates[release.index],
            borderColor: versionColors[index],
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
                content: 'v' + release.version,
                enabled: true,
                position: 'top',
                backgroundColor: versionColors[index],
                color: 'white',
                font: {
                    size: 10,
                }
            }
        }));
        
        // Initialize the chart
        const ctx = document.getElementById('downloadsChart').getContext('2d');
        let chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dates,
                datasets: ${JSON.stringify(datasets)}
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: 'chatgpt-md Plugin Downloads Over Time',
                        font: {
                            size: 16
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return new Date(context[0].label).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                });
                            },
                            label: function(context) {
                                if (context.parsed.y === null) return;
                                return context.dataset.label + ': ' + (context.parsed.y || 0).toLocaleString() + ' downloads';
                            }
                        }
                    },
                    annotation: {
                        annotations: annotations
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'month',
                            tooltipFormat: 'MMM d, yyyy',
                            displayFormats: {
                                month: 'MMM yyyy'
                            }
                        },
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Total Downloads'
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Growth Rate (downloads/day)'
                        },
                        grid: {
                            drawOnChartArea: false // Only display ticks, not grid lines
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        }
                    }
                }
            },
            plugins: [verticalLinePlugin]
        });
        
        // Initialize the time slider
        const slider = document.getElementById('time-slider');
        const timeStart = document.getElementById('time-start');
        const timeEnd = document.getElementById('time-end');
        
        noUiSlider.create(slider, {
            start: [oldestDate, newestDate],
            connect: true,
            step: 86400000, // 1 day in milliseconds
            range: {
                'min': oldestDate,
                'max': newestDate
            },
            format: {
                to: function (value) {
                    return Math.round(value);
                },
                from: function (value) {
                    return Math.round(value);
                }
            }
        });
        
        // Format the display of dates
        function formatDate(timestamp) {
            return new Date(timestamp).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
        
        // Update the time display
        function updateTimeDisplay(values) {
            timeStart.textContent = formatDate(values[0]);
            timeEnd.textContent = formatDate(values[1]);
        }
        
        // Initial display
        slider.noUiSlider.on('update', function (values) {
            updateTimeDisplay(values);
        });
        
        // Update chart when slider changes
        slider.noUiSlider.on('change', function (values) {
            const startDate = new Date(parseInt(values[0]));
            const endDate = new Date(parseInt(values[1]));
            
            // Update chart x-axis min and max
            chart.options.scales.x.min = startDate.toISOString();
            chart.options.scales.x.max = endDate.toISOString();
            chart.update();
        });
        
        // Reset zoom button
        function addResetZoomButton() {
            const resetButton = document.createElement('button');
            resetButton.textContent = 'Reset Zoom';
            resetButton.style.position = 'absolute';
            resetButton.style.top = '10px';
            resetButton.style.right = '10px';
            resetButton.style.padding = '5px 10px';
            resetButton.style.backgroundColor = '#f8f9fa';
            resetButton.style.border = '1px solid #dee2e6';
            resetButton.style.borderRadius = '4px';
            resetButton.style.cursor = 'pointer';
            resetButton.style.fontSize = '12px';
            
            resetButton.addEventListener('click', function() {
                // Reset the slider
                slider.noUiSlider.set([oldestDate, newestDate]);
                
                // Reset the chart
                chart.options.scales.x.min = undefined;
                chart.options.scales.x.max = undefined;
                chart.update();
            });
            
            document.querySelector('.chart-container').appendChild(resetButton);
        }
        
        // Add reset button after chart initialization
        addResetZoomButton();
    </script>
</body>
</html>`;

// Write the HTML file
console.log(`Writing chart to ${outputHtmlFile}...`);
fs.writeFileSync(outputHtmlFile, htmlContent);

console.log(`Done! Open ${outputHtmlFile} in your browser to view the chart.`);
