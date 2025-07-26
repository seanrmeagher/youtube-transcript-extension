// Debug logging
function log(message) {
  console.log('[YouTube Transcript Extension]', message);
}

// Wait for the page to load and find the subscribe button area
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    log(`Looking for element: ${selector}`);
    const element = document.querySelector(selector);
    if (element) {
      log(`Found element immediately: ${selector}`);
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        log(`Found element after mutation: ${selector}`);
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      log(`Element not found within timeout: ${selector}`);
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

// Extract video ID from current URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Extract transcript data from the YouTube page
async function fetchTranscript(videoId) {
  try {
    log(`Extracting transcript for video ID: ${videoId}`);
    
    // Method 1: Try to find existing transcript data in the page
    const pageTranscript = extractTranscriptFromPage();
    if (pageTranscript) {
      log('Found transcript data in page');
      return pageTranscript;
    }
    
    // Method 2: Try to automatically open transcript and extract
    const autoTranscript = await openAndExtractTranscript();
    if (autoTranscript) {
      log('Found transcript data via automation');
      return autoTranscript;
    }
    
    // Method 3: Try to get transcript from ytInitialPlayerResponse
    const playerResponse = extractPlayerResponse();
    if (playerResponse) {
      const transcriptFromPlayer = await extractTranscriptFromPlayerResponse(playerResponse, videoId);
      if (transcriptFromPlayer) {
        log('Found transcript data in player response');
        return transcriptFromPlayer;
      }
    }
    
    // Method 4: Try direct API call as fallback
    return await fetchTranscriptFromAPI(videoId);
    
  } catch (error) {
    log('Error fetching transcript: ' + error.message);
    console.error('Error fetching transcript:', error);
    throw error;
  }
}

// Extract transcript from existing page elements
function extractTranscriptFromPage() {
  try {
    // Look for transcript panel if it's open
    const transcriptPanel = document.querySelector('ytd-transcript-renderer');
    if (transcriptPanel) {
      return extractTranscriptFromOpenPanel(transcriptPanel);
    }
    
    return null;
  } catch (error) {
    log('Error extracting transcript from page: ' + error.message);
    return null;
  }
}

// Automatically open transcript panel and extract data
async function openAndExtractTranscript() {
  try {
    log('Attempting to open transcript panel automatically');
    
    // First check if transcript is already open
    let transcriptPanel = document.querySelector('ytd-transcript-renderer');
    if (transcriptPanel) {
      log('Transcript panel already open');
      return extractTranscriptFromOpenPanel(transcriptPanel);
    }
    
    // Look for the "Show transcript" button
    const transcriptButtons = [
      'button[aria-label*="transcript" i]',
      'button[aria-label*="Show transcript" i]',
      'yt-button-shape[aria-label*="transcript" i]',
      '[role="button"][aria-label*="transcript" i]',
      // Try more generic selectors
      'ytd-menu-renderer yt-formatted-string:contains("transcript")',
      'ytd-toggle-button-renderer[aria-label*="transcript" i]'
    ];
    
    let transcriptButton = null;
    
    // Try each selector
    for (const selector of transcriptButtons) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent?.toLowerCase() || '';
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
        if (text.includes('transcript') || ariaLabel.includes('transcript')) {
          transcriptButton = element;
          log(`Found transcript button with selector: ${selector}`);
          break;
        }
      }
      if (transcriptButton) break;
    }
    
    // If no direct button found, try the three-dot menu
    if (!transcriptButton) {
      log('Looking for transcript in three-dot menu');
      const moreButton = document.querySelector('ytd-menu-renderer #button, ytd-menu-renderer button[aria-label*="More" i]');
      if (moreButton) {
        log('Clicking more menu button');
        moreButton.click();
        
        // Wait for menu to open and look for transcript option
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item');
        for (const item of menuItems) {
          const text = item.textContent?.toLowerCase() || '';
          if (text.includes('transcript')) {
            transcriptButton = item;
            log('Found transcript in dropdown menu');
            break;
          }
        }
      }
    }
    
    if (!transcriptButton) {
      log('No transcript button found');
      return null;
    }
    
    // Click the transcript button
    log('Clicking transcript button');
    transcriptButton.click();
    
    // Wait for the transcript panel to load
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds max
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      transcriptPanel = document.querySelector('ytd-transcript-renderer');
      
      if (transcriptPanel) {
        log('Transcript panel opened successfully');
        // Wait a bit more for content to load
        await new Promise(resolve => setTimeout(resolve, 1000));
        return extractTranscriptFromOpenPanel(transcriptPanel);
      }
      
      attempts++;
    }
    
    log('Transcript panel did not open after clicking button');
    return null;
    
  } catch (error) {
    log('Error in openAndExtractTranscript: ' + error.message);
    return null;
  }
}

// Extract transcript from an open transcript panel
function extractTranscriptFromOpenPanel(transcriptPanel) {
  try {
    const transcriptItems = transcriptPanel.querySelectorAll('ytd-transcript-segment-renderer');
    
    if (transcriptItems.length === 0) {
      log('No transcript segments found in open panel');
      return null;
    }
    
    let transcriptWithTimestamps = '';
    transcriptItems.forEach(item => {
      const textElement = item.querySelector('.segment-text, [class*="cue-group"] [class*="cue"]');
      const timestampElement = item.querySelector('.segment-timestamp, [class*="timestamp"]');
      
      if (textElement) {
        const text = textElement.textContent.trim();
        const timestamp = timestampElement ? timestampElement.textContent.trim() : '';
        
        if (timestamp) {
          transcriptWithTimestamps += `[${timestamp}] ${text}\n`;
        } else {
          transcriptWithTimestamps += `${text}\n`;
        }
      }
    });
    
    if (transcriptWithTimestamps.trim()) {
      log(`Extracted ${transcriptWithTimestamps.length} characters from open transcript panel with timestamps`);
      return transcriptWithTimestamps.trim();
    }
    
    return null;
  } catch (error) {
    log('Error extracting from open panel: ' + error.message);
    return null;
  }
}

// Extract ytInitialPlayerResponse from page
function extractPlayerResponse() {
  try {
    // Method 1: Look for ytInitialPlayerResponse in scripts
    const scripts = document.querySelectorAll('script');
    for (let script of scripts) {
      const content = script.textContent;
      if (content && content.includes('ytInitialPlayerResponse')) {
        // Try different regex patterns
        const patterns = [
          /ytInitialPlayerResponse\s*=\s*({.+?});/,
          /ytInitialPlayerResponse"\s*:\s*({.+?}),/,
          /"ytInitialPlayerResponse"\s*:\s*({.+?})(?:,|})/
        ];
        
        for (let pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            try {
              const parsed = JSON.parse(match[1]);
              log('Successfully extracted player response');
              return parsed;
            } catch (e) {
              log(`Failed to parse JSON with pattern: ${pattern}`);
              continue;
            }
          }
        }
      }
    }
    
    // Method 2: Check if it's available as a global variable
    if (typeof window.ytInitialPlayerResponse !== 'undefined') {
      log('Found ytInitialPlayerResponse as global variable');
      return window.ytInitialPlayerResponse;
    }
    
    log('No player response found');
    return null;
  } catch (error) {
    log('Error extracting player response: ' + error.message);
    return null;
  }
}

// Extract transcript from player response
async function extractTranscriptFromPlayerResponse(playerResponse, videoId) {
  try {
    const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captions || captions.length === 0) {
      throw new Error('No captions found in player response');
    }
    
    log(`Found ${captions.length} caption tracks`);
    captions.forEach((track, i) => {
      log(`Track ${i}: ${track.name?.simpleText || 'Unknown'} (${track.languageCode}) kind: ${track.kind || 'none'}`);
    });
    
    // Find the best caption track
    let selectedTrack = captions.find(track => 
      track.languageCode.startsWith('en') && track.kind !== 'asr'
    ) || captions.find(track => 
      track.languageCode.startsWith('en')
    ) || captions[0];
    
    if (!selectedTrack) {
      throw new Error('No suitable caption track found');
    }
    
    log(`Using caption track: ${selectedTrack.name?.simpleText || 'Unknown'} (${selectedTrack.languageCode})`);
    log(`Base URL: ${selectedTrack.baseUrl}`);
    
    // Fetch the transcript from the base URL
    let transcriptUrl = selectedTrack.baseUrl;
    
    // Ensure the URL is properly formatted
    if (!transcriptUrl.startsWith('http')) {
      transcriptUrl = 'https://www.youtube.com' + transcriptUrl;
    }
    
    // Add format parameter to ensure we get XML
    if (!transcriptUrl.includes('fmt=')) {
      transcriptUrl += transcriptUrl.includes('?') ? '&fmt=srv3' : '?fmt=srv3';
    }
    
    log(`Fetching transcript from: ${transcriptUrl}`);
    
    const response = await fetch(transcriptUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch transcript: ${response.status} ${response.statusText}`);
    }
    
    const transcriptXml = await response.text();
    log(`Received transcript XML: ${transcriptXml.length} characters`);
    log(`XML preview: ${transcriptXml.substring(0, 300)}...`);
    
    if (!transcriptXml.trim()) {
      throw new Error('Empty transcript response from server');
    }
    
    return transcriptXml;
    
  } catch (error) {
    log('Error extracting transcript from player response: ' + error.message);
    throw error;
  }
}

// Fallback API method
async function fetchTranscriptFromAPI(videoId) {
  try {
    log('Trying fallback API method...');
    
    const listUrl = `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`;
    const listResponse = await fetch(listUrl);
    
    if (!listResponse.ok) {
      throw new Error('No transcript available via API');
    }
    
    const listText = await listResponse.text();
    if (!listText.trim()) {
      throw new Error('Empty API response');
    }
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(listText, 'text/xml');
    const tracks = xmlDoc.getElementsByTagName('track');
    
    if (tracks.length === 0) {
      throw new Error('No transcript tracks found');
    }
    
    const track = tracks[0];
    const langCode = track.getAttribute('lang_code') || 'en';
    
    const transcriptUrl = `https://www.youtube.com/api/timedtext?lang=${langCode}&v=${videoId}&fmt=srv3`;
    const transcriptResponse = await fetch(transcriptUrl);
    
    if (!transcriptResponse.ok) {
      throw new Error('Failed to fetch transcript content');
    }
    
    return await transcriptResponse.text();
    
  } catch (error) {
    log('Fallback API method failed: ' + error.message);
    throw error;
  }
}

// Convert transcript data to readable text with timestamps
function formatTranscript(transcriptData) {
  try {
    log('Formatting transcript data...');
    
    // If it's already formatted text with timestamps (from page extraction), return as-is
    if (typeof transcriptData === 'string' && !transcriptData.includes('<')) {
      log(`Using formatted transcript: ${transcriptData.length} characters`);
      return transcriptData;
    }
    
    // If it's XML, parse it and add timestamps
    if (typeof transcriptData === 'string' && transcriptData.includes('<')) {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(transcriptData, 'text/xml');
      
      // Check for XML parsing errors
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error('XML parsing error: ' + parserError.textContent);
      }
      
      const textElements = xmlDoc.getElementsByTagName('text');
      
      if (textElements.length === 0) {
        throw new Error('No text elements found in transcript XML');
      }
      
      let formattedTranscript = '';
      
      for (let element of textElements) {
        let text = element.textContent || '';
        // Decode HTML entities
        text = text.replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'");
        
        if (text.trim()) {
          // Get timestamp from 'start' attribute
          const startTime = element.getAttribute('start');
          if (startTime) {
            const timestamp = formatTimestamp(parseFloat(startTime));
            formattedTranscript += `[${timestamp}] ${text.trim()}\n`;
          } else {
            formattedTranscript += `${text.trim()}\n`;
          }
        }
      }
      
      if (!formattedTranscript.trim()) {
        throw new Error('No transcript text found in XML');
      }
      
      log(`Extracted ${formattedTranscript.length} characters from XML transcript with timestamps`);
      return formattedTranscript.trim();
    }
    
    throw new Error('Unknown transcript data format');
    
  } catch (error) {
    log('Error formatting transcript: ' + error.message);
    throw error;
  }
}

// Convert seconds to MM:SS or HH:MM:SS format
function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

// Get video title from page
function getVideoTitle() {
  try {
    // Try multiple selectors for the video title
    const titleSelectors = [
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1.title .ytd-video-primary-info-renderer',
      'h1.style-scope.ytd-watch-metadata',
      '#title h1',
      '.title.ytd-video-primary-info-renderer',
      'ytd-watch-metadata h1'
    ];
    
    for (const selector of titleSelectors) {
      const titleElement = document.querySelector(selector);
      if (titleElement && titleElement.textContent.trim()) {
        let title = titleElement.textContent.trim();
        // Clean up title for filename (remove invalid characters)
        title = title.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
        log(`Found video title: ${title}`);
        return title;
      }
    }
    
    log('Could not find video title');
    return null;
  } catch (error) {
    log('Error getting video title: ' + error.message);
    return null;
  }
}

// Create formatted transcript with header info
function createFormattedTranscript(transcriptText, videoId) {
  const title = getVideoTitle() || 'Unknown Video';
  const url = window.location.href;
  
  const header = `Title: ${title}
URL: ${url}

--- TRANSCRIPT ---

`;
  
  return header + transcriptText;
}

// Download text as file
function downloadTranscript(text, videoId) {
  const formattedText = createFormattedTranscript(text, videoId);
  const blob = new Blob([formattedText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  // Get video title for filename
  const title = getVideoTitle();
  let filename;
  if (title) {
    filename = `${title}.txt`;
  } else {
    filename = `youtube-transcript-${videoId}.txt`;
  }
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Create and add the transcript download button
async function addTranscriptButton() {
  try {
    log('Starting to add transcript button');
    
    // Check if button already exists
    if (document.getElementById('transcript-download-btn')) {
      log('Button already exists, skipping');
      return;
    }
    
    // Try multiple selectors for the subscribe area
    const selectors = [
      '#subscribe-button',
      '[aria-label*="Subscribe"]',
      'ytd-subscribe-button-renderer',
      '#owner-sub-count',
      '.ytd-video-owner-renderer',
      '.ytd-channel-name',
      '#above-the-fold #owner'
    ];
    
    let subscribeContainer = null;
    
    for (const selector of selectors) {
      try {
        subscribeContainer = await waitForElement(selector, 2000);
        log(`Found subscribe container with selector: ${selector}`);
        break;
      } catch (e) {
        log(`Selector ${selector} not found, trying next...`);
      }
    }
    
    if (!subscribeContainer) {
      log('No subscribe button container found with any selector');
      return;
    }
    
    // Create the transcript button
    const transcriptBtn = document.createElement('button');
    transcriptBtn.id = 'transcript-download-btn';
    transcriptBtn.innerHTML = 'Download Transcript';
    
    // Get subscribe button styling to match (but keep red background)
    const subscribeButton = subscribeContainer.querySelector('button, yt-button-shape') || subscribeContainer;
    const computedStyle = window.getComputedStyle(subscribeButton);
    
    // Extract key styling properties from subscribe button
    const height = computedStyle.height || '36px';
    const fontSize = computedStyle.fontSize || '14px';
    const fontWeight = computedStyle.fontWeight || '500';
    const fontFamily = computedStyle.fontFamily || '"YouTube Sans", "Roboto", sans-serif';
    const lineHeight = computedStyle.lineHeight || 'normal';
    const textAlign = computedStyle.textAlign || 'center';
    
    // Use standard YouTube button border radius (always rounded)
    const borderRadius = '18px';
    
    // Calculate appropriate padding based on height
    const heightNum = parseInt(height);
    const verticalPadding = Math.max(0, Math.floor((heightNum - 20) / 2));
    const horizontalPadding = '16px';
    
    log(`Subscribe button styling - height: ${height}, fontSize: ${fontSize}, borderRadius: ${borderRadius}`);
    
    transcriptBtn.style.cssText = `
      background-color: #cc0000;
      color: white;
      border: none;
      border-radius: ${borderRadius};
      padding: ${verticalPadding}px ${horizontalPadding};
      margin-left: 8px;
      font-size: ${fontSize};
      font-weight: bold;
      font-family: ${fontFamily};
      line-height: ${lineHeight};
      text-align: ${textAlign};
      height: ${height};
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s ease;
      white-space: nowrap;
      min-width: fit-content;
      box-sizing: border-box;
      vertical-align: top;
    `;
    
    transcriptBtn.addEventListener('mouseenter', () => {
      transcriptBtn.style.backgroundColor = '#a00000';
    });
    
    transcriptBtn.addEventListener('mouseleave', () => {
      transcriptBtn.style.backgroundColor = '#cc0000';
    });
    
    transcriptBtn.addEventListener('click', async () => {
      const originalText = transcriptBtn.innerHTML;
      transcriptBtn.innerHTML = '⏳ Loading...';
      transcriptBtn.disabled = true;
      
      try {
        const videoId = getVideoId();
        if (!videoId) {
          throw new Error('Video ID not found');
        }
        
        const transcriptData = await fetchTranscript(videoId);
        const formattedText = formatTranscript(transcriptData);
        
        if (!formattedText.trim()) {
          throw new Error('No transcript text found');
        }
        
        // Copy to clipboard
        try {
          await navigator.clipboard.writeText(formattedText);
          log('Transcript copied to clipboard');
        } catch (clipboardError) {
          log('Failed to copy to clipboard: ' + clipboardError.message);
        }
        
        downloadTranscript(formattedText, videoId);
        
        transcriptBtn.innerHTML = '✓ Downloaded & Copied!';
        setTimeout(() => {
          transcriptBtn.innerHTML = originalText;
          transcriptBtn.disabled = false;
        }, 2000);
        
      } catch (error) {
        console.error('Transcript download failed:', error);
        transcriptBtn.innerHTML = '❌ Failed';
        setTimeout(() => {
          transcriptBtn.innerHTML = originalText;
          transcriptBtn.disabled = false;
        }, 2000);
      }
    });
    
    // Insert the button next to the subscribe button
    const parent = subscribeContainer.parentElement;
    if (parent) {
      parent.insertBefore(transcriptBtn, subscribeContainer.nextSibling);
      log('Transcript button added successfully');
    } else {
      // Fallback: add to the subscribe container itself
      subscribeContainer.appendChild(transcriptBtn);
      log('Transcript button added to subscribe container directly');
    }
    
  } catch (error) {
    log('Error adding transcript button: ' + error.message);
    console.error('Error adding transcript button:', error);
  }
}

// Initialize when page loads
function init() {
  log('Extension initializing...');
  
  // Add button when page first loads
  setTimeout(addTranscriptButton, 2000); // Give YouTube time to load
  
  // Re-add button when navigating between videos (YouTube is a SPA)
  let currentUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      log('URL changed, re-adding button');
      setTimeout(addTranscriptButton, 2000); // Longer delay for navigation
    }
  });
  
  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
  
  // Also try to add button on specific YouTube events
  setInterval(() => {
    if (window.location.href.includes('/watch') && !document.getElementById('transcript-download-btn')) {
      log('Periodic check - trying to add button');
      addTranscriptButton();
    }
  }, 5000); // Check every 5 seconds
}

// Start the extension
log('Content script loaded');
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}