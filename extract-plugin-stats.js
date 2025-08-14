#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");

// Parse arguments
const pluginName = process.argv[2];
if (!pluginName) {
  console.error("Usage: node extract-plugin-stats.js <plugin-name>");
  process.exit(1);
}

const statsFile = "community-plugin-stats.json";
const outputFile = `${pluginName.toLowerCase().replace(/\s+/g, "-")}-history.json`;

console.log(`Extracting stats for "${pluginName}"...`);

// Get git commits
const commits = execSync(`git log --pretty=format:"%H %at %s" -- ${statsFile}`, { encoding: "utf8" })
  .trim()
  .split("\n")
  .map(line => {
    const [hash, timestamp, ...messageParts] = line.split(" ");
    return { hash, timestamp: parseInt(timestamp) * 1000, message: messageParts.join(" ") };
  })
  .filter(commit => commit.message !== "chore: Format JSON");

console.log(`Processing ${commits.length} commits...`);

// Step 1: Collect raw data from commits
const rawData = [];

for (const commit of commits) {
  try {
    const fileContent = execSync(`git show ${commit.hash}:${statsFile}`, { encoding: "utf8" });
    const statsData = JSON.parse(fileContent);
    
    if (!statsData[pluginName]) {
      console.log(`Plugin not found in ${commit.hash.substring(0, 8)}, stopping`);
      break;
    }

    const pluginData = statsData[pluginName];
    const date = new Date(commit.timestamp).toISOString().split("T")[0];
    
    // Extract versions (skip non-version keys and beta versions)
    const versions = {};
    for (const [key, value] of Object.entries(pluginData)) {
      if (!["downloads", "updated"].includes(key) && !key.endsWith("-beta")) {
        versions[key] = value;
      }
    }

    rawData.push({
      hash: commit.hash,
      timestamp: commit.timestamp,
      date,
      downloads: pluginData.downloads,
      versions
    });

  } catch (error) {
    console.error(`Error processing ${commit.hash}: ${error.message}`);
  }
}

// Sort raw data by timestamp (newest to oldest)
rawData.sort((a, b) => b.timestamp - a.timestamp);

// Step 2: Filter out anomalies (downloads inconsistencies)
const validData = [];

for (let i = 0; i < rawData.length; i++) {
  const current = rawData[i];
  let isValid = true;

  // Check against previous (newer in time) point
  if (i > 0) {
    const prev = rawData[i - 1];
    if (current.downloads > prev.downloads) {
      console.log(`Anomaly: ${current.date} has ${current.downloads} > previous ${prev.downloads}`);
      isValid = false;
    }
  }

  // Check against next (older in time) point
  if (i < rawData.length - 1) {
    const next = rawData[i + 1];
    if (current.downloads < next.downloads) {
      console.log(`Anomaly: ${current.date} has ${current.downloads} < next ${next.downloads}`);
      isValid = false;
    }
  }

  if (isValid) {
    validData.push(current);
  }
}

// Step 3: Calculate daily growth (iterate from oldest to newest)
const history = {};
let previousDownloads = 0;
let previousTimestamp = 0;

for (let i = validData.length - 1; i >= 0; i--) {
  const point = validData[i];
  let dailyGrowth = 0;

  if (i === validData.length - 1) {
    // First data point (oldest)
    dailyGrowth = point.downloads;
  } else {
    const daysDifference = (point.timestamp - previousTimestamp) / (1000 * 60 * 60 * 24);
    const downloadDifference = point.downloads - previousDownloads;
    dailyGrowth = daysDifference > 0 ? Math.round(downloadDifference / daysDifference) : 0;
  }

  history[point.timestamp] = {
    date: point.date,
    data: {
      downloads: point.downloads,
      dailyGrowth: dailyGrowth,
      ...point.versions
    }
  };

  previousDownloads = point.downloads;
  previousTimestamp = point.timestamp;
}

// Step 4: Fix data inconsistencies (duplicates and dailyGrowth: 0)
console.log("Fixing data inconsistencies...");
const fixedHistory = fixDataInconsistencies(history);
const duplicatesRemoved = Object.keys(history).length - Object.keys(fixedHistory).length;

if (duplicatesRemoved > 0) {
  console.log(`Fixed data: removed ${duplicatesRemoved} duplicates, recalculated daily growth`);
} else {
  console.log("No data inconsistencies found");
}

// Always use the fixed data (it handles dailyGrowth recalculation even without duplicates)
const finalHistory = fixedHistory;

// Save results
fs.writeFileSync(outputFile, JSON.stringify(finalHistory, null, 2));
console.log(`Saved ${Object.keys(finalHistory).length} data points to ${outputFile}`);

function fixDataInconsistencies(data) {
  // Convert to array and sort by timestamp
  const entries = Object.entries(data).map(([timestamp, entry]) => ({
    timestamp: parseInt(timestamp),
    ...entry
  })).sort((a, b) => a.timestamp - b.timestamp);

  // Group by date and keep only the latest entry per date
  const uniqueEntries = {};
  const dateGroups = {};

  entries.forEach(entry => {
    if (!dateGroups[entry.date]) {
      dateGroups[entry.date] = [];
    }
    dateGroups[entry.date].push(entry);
  });

  // For each date, keep only the entry with the highest timestamp (latest in the day)
  Object.keys(dateGroups).forEach(date => {
    const entriesForDate = dateGroups[date];
    if (entriesForDate.length > 1) {
      console.log(`Found ${entriesForDate.length} entries for ${date}, keeping the latest one`);
      entriesForDate.sort((a, b) => a.timestamp - b.timestamp);
    }
    const latestEntry = entriesForDate[entriesForDate.length - 1];
    uniqueEntries[latestEntry.timestamp] = {
      date: latestEntry.date,
      data: latestEntry.data
    };
  });

  // Convert back to sorted array for daily growth calculation
  const sortedEntries = Object.entries(uniqueEntries)
    .map(([timestamp, entry]) => ({
      timestamp: parseInt(timestamp),
      ...entry
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Recalculate daily growth
  let previousDownloads = 0;
  const fixedData = {};

  sortedEntries.forEach((entry, index) => {
    const currentDownloads = entry.data.downloads;
    let dailyGrowth;
    
    if (index === 0) {
      dailyGrowth = currentDownloads;
    } else {
      dailyGrowth = currentDownloads - previousDownloads;
      
      // Check for gaps in dates
      const currentDate = new Date(entry.date);
      const prevDate = new Date(sortedEntries[index - 1].date);
      const dayDiff = Math.round((currentDate - prevDate) / (1000 * 60 * 60 * 24));
      
      if (dayDiff > 1) {
        console.log(`Gap detected between ${sortedEntries[index - 1].date} and ${entry.date} (${dayDiff} days)`);
        dailyGrowth = Math.round(dailyGrowth / dayDiff);
      }
    }
    
    if (dailyGrowth < 0) {
      console.log(`Warning: Negative growth detected on ${entry.date}: ${dailyGrowth}`);
      dailyGrowth = 0;
    }
    
    fixedData[entry.timestamp] = {
      date: entry.date,
      data: {
        ...entry.data,
        dailyGrowth: dailyGrowth
      }
    };
    
    previousDownloads = currentDownloads;
  });

  return fixedData;
}