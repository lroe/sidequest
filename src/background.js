chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ask_gemini",
    title: "Ask Gemini what's this",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "explain_gemini",
    title: "Ask Gemini to explain step-by-step",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ask_gemini") {
    const doubt = `What's this? "${info.selectionText}"`;
    handleBranching({
      context: '', 
      doubt: doubt,
      platform: 'gemini',
      sourceUrl: tab.url,
      hasContext: false
    });
  } else if (info.menuItemId === "explain_gemini") {
    const doubt = `I didn't understand the following text. Explain each concept one concept at a time. Move to the next when I say next. Make sure I understand it:\n\n"${info.selectionText}"`;
    handleBranching({
      context: '', 
      doubt: doubt,
      platform: 'gemini',
      sourceUrl: tab.url,
      hasContext: false
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'branch_chat') {
    handleBranching(message.data).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      console.error(err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // async
  }
});

async function handleBranching({ context, doubt, platform, sourceUrl, hasContext }) {
  let targetUrl = '';
  
  if (platform === 'same' && hasContext) {
    targetUrl = sourceUrl.includes('chatgpt.com') ? 'https://chatgpt.com/' : 'https://gemini.google.com/app';
  } else if (platform === 'chatgpt' || (platform === 'same' && !hasContext)) {
    // Default to ChatGPT if no platform context exists and 'same' was selected
    targetUrl = 'https://chatgpt.com/';
  } else if (platform === 'gemini') {
    targetUrl = 'https://gemini.google.com/app';
  }

  // Create new tab
  const newTab = await chrome.tabs.create({ url: targetUrl });
  
  // Combine context and doubt into a prompt
  let fullPrompt = doubt;
  if (hasContext && context && context !== 'No context found.') {
    fullPrompt = `Here is the context of our previous conversation:\n\n---\n${context}\n---\n\nBased on the above context, I have a doubt/question that I'd like to ask in this new thread:\n${doubt}`;
  }

  return new Promise((resolve, reject) => {
    const listener = async (tabId, info, tab) => {
      if (tabId === newTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        
        // Add a slight delay to allow client-side hydration
        setTimeout(async () => {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: newTab.id },
              func: injectAndSendPrompt,
              args: [fullPrompt, targetUrl]
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 3000); // 3 second delay for complex apps to load
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function injectAndSendPrompt(promptText, url) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function setNativeValue(element, value) {
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      const valueSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value').set;
      const prototype = Object.getPrototypeOf(element);
      const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      
      if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
      } else if (valueSetter) {
        valueSetter.call(element, value);
      } else {
        element.value = value;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      element.focus();
      document.execCommand('insertText', false, value);
    }
  }

  async function injectChatGPT() {
    let editor = document.querySelector('#prompt-textarea');
    if (!editor) return;
    
    await setNativeValue(editor, promptText);
    await sleep(500);
    
    const sendBtn = document.querySelector('[data-testid="send-button"]');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    }
  }

  async function injectGemini() {
    const editor = document.querySelector('rich-textarea div[contenteditable="true"]') || 
                   document.querySelector('div[role="textbox"][contenteditable="true"]');
    if (!editor) return;
    
    await setNativeValue(editor, promptText);
    await sleep(500);
    
    const sendBtns = Array.from(document.querySelectorAll('button')).filter(b => {
      const aria = b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '';
      return aria.toLowerCase().includes('send message') || aria.toLowerCase().includes('send');
    });
    
    if (sendBtns.length > 0) {
      sendBtns[sendBtns.length - 1].click();
    } else {
      editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
    }
  }

  if (url.includes('chatgpt.com')) {
    injectChatGPT();
  } else if (url.includes('gemini.google.com')) {
    injectGemini();
  }
}
