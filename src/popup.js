document.addEventListener('DOMContentLoaded', () => {
  const branchBtn = document.getElementById('branchBtn');
  const doubtInput = document.getElementById('doubtInput');
  const status = document.getElementById('status');
  const statusText = status.querySelector('.status-text');

  branchBtn.addEventListener('click', async () => {
    const doubt = doubtInput.value.trim();
    const platform = document.querySelector('input[name="platform"]:checked').value;
    
    if (!doubt) {
      doubtInput.focus();
      return;
    }

    try {
      // Show loading
      status.classList.remove('hidden');
      branchBtn.disabled = true;

      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const isOnSupportedPlatform = tab.url.includes('chatgpt.com') || tab.url.includes('gemini.google.com');
      let context = '';

      if (isOnSupportedPlatform) {
        // Inject script to extract context
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractChatContext,
          args: [tab.url]
        });
        context = result;
      }

      statusText.textContent = 'Opening new branch...';

      // Send to background to handle new tab and injection
      chrome.runtime.sendMessage({
        action: 'branch_chat',
        data: {
          context,
          doubt,
          platform,
          sourceUrl: tab.url,
          hasContext: isOnSupportedPlatform
        }
      }, (response) => {
        if (response && response.success) {
          window.close(); // Close popup when done
        } else {
          throw new Error(response ? response.error : 'Failed to branch chat.');
        }
      });
      
    } catch (err) {
      status.querySelector('.spinner').style.display = 'none';
      statusText.textContent = err.message;
      statusText.style.color = '#d63638'; // WordPress error red
      
      branchBtn.disabled = false;
    }
  });
});

// This runs in the context of the page
function extractChatContext(url) {
  let text = '';
  
  if (url.includes('chatgpt.com')) {
    // ChatGPT extraction
    const messages = document.querySelectorAll('[data-message-author-role]');
    messages.forEach(msg => {
      const role = msg.getAttribute('data-message-author-role');
      const content = msg.innerText.trim();
      if (content) {
        text += `${role.toUpperCase()}: ${content}\n\n`;
      }
    });
  } else if (url.includes('gemini.google.com')) {
    // Gemini extraction
    const userQueries = document.querySelectorAll('.query-text');
    const responses = document.querySelectorAll('.message-content');
    
    const count = Math.max(userQueries.length, responses.length);
    for (let i = 0; i < count; i++) {
      if (userQueries[i]) {
        text += `USER: ${userQueries[i].innerText.trim()}\n\n`;
      }
      if (responses[i]) {
        text += `ASSISTANT: ${responses[i].innerText.trim()}\n\n`;
      }
    }
    
    // Fallback if specific classes aren't found
    if (!text) {
      text = document.body.innerText.substring(0, 5000); // just grab body text
    }
  }

  // Limit size so it doesn't crash passing via messaging
  if (text.length > 15000) {
    text = "...(truncated)...\n\n" + text.substring(text.length - 15000);
  }

  return text || 'No context found.';
}
