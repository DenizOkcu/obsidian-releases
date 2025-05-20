#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Configuration
const pluginName = "chatgpt-md";
const statsFile = "community-plugin-stats.json";
const outputFile = `${pluginName}-history.json`;

console.log(`Extracting stats history for "${pluginName}" plugin...`);

// Get git commits that modified the stats file
const gitLogCommand = `git log --pretty=format:"%H %at" -- ${statsFile}`;
const commits = execSync(gitLogCommand, { encoding: "utf8" })
  .trim()
  .split("\n")
  .map((line) => {
    const [hash, timestamp] = line.split(" ");
    return { hash, timestamp: parseInt(timestamp) * 1000 }; // Convert to milliseconds
  });

console.log(`Found ${commits.length} commits that modified the stats file.`);

// Process each commit
const history = [];
let lastValidDownloads = 0;
let foundFirstEntry = false;

// Loop through commits (newest to oldest)
for (const commit of commits) {
  try {
    // Get stats file content at this commit
    const fileContent = execSync(`git show ${commit.hash}:${statsFile}`, {
      encoding: "utf8",
    });
    const statsData = JSON.parse(fileContent);

    // Check if the plugin exists in this version of the file
    if (!statsData[pluginName]) {
      console.log(
        `Plugin "${pluginName}" not found in commit ${commit.hash}. Stopping.`,
      );
      break;
    }

    const pluginData = statsData[pluginName];
    const downloads = pluginData.downloads || 0;
    const date = new Date(commit.timestamp).toISOString().split("T")[0]; // Format as YYYY-MM-DD

    // Skip if date already exists in history (same day)
    if (history.some((entry) => entry.date === date)) {
      console.log(`Skipping duplicate date: ${date}`);
      continue;
    }

    // For the first entry, accept it regardless of download count
    if (!foundFirstEntry) {
      foundFirstEntry = true;
      lastValidDownloads = downloads;

      // Create a record for this point in time
      const entry = {
        date,
        hash: commit.hash,
        downloads,
        versions: Object.keys(pluginData)
          .filter((key) => key !== "downloads" && key !== "updated")
          .reduce((obj, key) => {
            obj[key] = pluginData[key];
            return obj;
          }, {}),
      };

      history.push(entry);
      console.log(
        `Added entry for ${date}: ${downloads} downloads (first entry)`,
      );
      continue;
    }

    // When going backwards in time, downloads should decrease or stay the same
    // Skip entries where the download count increases (which would be anomalous)
    if (downloads > lastValidDownloads) {
      console.log(
        `Skipping commit ${commit.hash} - downloads higher than newer commit (${downloads} > ${lastValidDownloads})`,
      );
      continue;
    }

    // Create a record for this point in time
    const entry = {
      date,
      hash: commit.hash,
      downloads,
      versions: Object.keys(pluginData)
        .filter((key) => key !== "downloads" && key !== "updated")
        .reduce((obj, key) => {
          obj[key] = pluginData[key];
          return obj;
        }, {}),
    };

    history.push(entry);
    lastValidDownloads = downloads;
    console.log(`Added entry for ${date}: ${downloads} downloads`);
  } catch (error) {
    console.error(`Error processing commit ${commit.hash}: ${error.message}`);
  }
}

// Sort history by date
history.sort((a, b) => new Date(a.date) - new Date(b.date));

// Write the results to a file
fs.writeFileSync(outputFile, JSON.stringify(history, null, 2));
console.log(`Saved history to ${outputFile}`);

// Generate an HTML file with the chart
generateChart(history);

function generateChart(data) {
  const chartFile = `${pluginName}-downloads-chart.html`;
  const labels = data.map((entry) => entry.date);
  const values = data.map((entry) => entry.downloads);

  // Calculate daily increases
  const increases = data.map((entry, index) => {
    if (index === 0) return 0;
    return entry.downloads - data[index - 1].downloads;
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pluginName} Download Statistics</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
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
            color: #333;
            text-align: center;
        }
        .chart-container {
            position: relative;
            height: 600px;
            width: 100%;
            margin-bottom: 30px;
        }
        .stats {
            margin: 20px 0;
            text-align: center;
            font-size: 16px;
            color: #555;
        }
        .stats strong {
            color: #333;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 30px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f8f8;
            font-weight: 600;
        }
        tr:hover {
            background-color: #f1f1f1;
        }
        .positive {
            color: #28a745;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${pluginName} Download Statistics</h1>
        
        <div class="stats">
            <p>
                First recorded: <strong>${data[0]?.date || "N/A"}</strong> | 
                Latest: <strong>${
                  data[data.length - 1]?.date || "N/A"
                }</strong> | 
                Total Downloads: <strong>${(
                  data[data.length - 1]?.downloads || 0
                ).toLocaleString()}</strong>
            </p>
        </div>
        
        <div class="chart-container">
            <canvas id="downloadsChart"></canvas>
        </div>
        
        <div class="chart-container">
            <canvas id="dailyIncreaseChart"></canvas>
        </div>
        
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Downloads</th>
                    <th>Daily Increase</th>
                    <th>Versions</th>
                </tr>
            </thead>
            <tbody>
                ${data
                  .map((entry, index) => {
                    const increase =
                      index > 0
                        ? entry.downloads - data[index - 1].downloads
                        : 0;
                    const versions = Object.keys(entry.versions).join(", ");
                    return `
                <tr>
                    <td>${entry.date}</td>
                    <td>${entry.downloads.toLocaleString()}</td>
                    <td class="${increase > 0 ? "positive" : ""}">${
                      increase > 0 ? "+" + increase.toLocaleString() : increase
                    }</td>
                    <td>${versions}</td>
                </tr>`;
                  })
                  .join("")}
            </tbody>
        </table>
    </div>

    <script>
        const ctx = document.getElementById('downloadsChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Total Downloads',
                    data: ${JSON.stringify(values)},
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '${pluginName} Plugin Downloads Over Time',
                        font: {
                            size: 18
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Downloads: ' + context.raw.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Total Downloads'
                        }
                    }
                }
            }
        });

        const ctxDaily = document.getElementById('dailyIncreaseChart').getContext('2d');
        new Chart(ctxDaily, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Daily Download Increase',
                    data: ${JSON.stringify(increases)},
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Daily Download Increases',
                        font: {
                            size: 18
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'New Downloads: ' + context.raw.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'New Downloads'
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;

  fs.writeFileSync(chartFile, html);
  console.log(`Generated chart: ${chartFile}`);
}
