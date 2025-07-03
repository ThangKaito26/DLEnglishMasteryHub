// script.js

// --- Theme Toggle Logic ---
const themeToggleBtn = document.getElementById('theme-toggle');
const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');

const applyTheme = () => {
    if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        themeToggleLightIcon.classList.remove('hidden');
        themeToggleDarkIcon.classList.add('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        themeToggleDarkIcon.classList.remove('hidden');
        themeToggleLightIcon.classList.add('hidden');
    }
};

themeToggleBtn.addEventListener('click', function() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('color-theme', isDark ? 'dark' : 'light');
    applyTheme();
});

// --- Tabbed Interface Logic ---
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();

    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
    attachEventListeners();
});


// --- Global State ---
let conversationHistory = [];
let unusedWords = [];
let currentUtteranceQueue = [];
let isSpeakingFullDialogue = false;
let recognition; // Global variable for SpeechRecognition instance
let isRecording = false; // To track recording state

// --- DOM Element References ---
const vocabularyInput = document.getElementById('vocabularyInput');
const messageBox = document.getElementById('messageBox');
const contentResultsArea = document.getElementById('content-results-area');
const quickSearchResults = document.getElementById('quickSearchResults');
const correctionModal = document.getElementById('correctionModal');
const closeCorrectionModalBtn = document.getElementById('closeCorrectionModal');
const modalCorrectionContent = document.getElementById('modalCorrectionContent');
const contentContainers = {};

// --- UI Helper Functions ---
function hideAllSections() {
    if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
    }
    if (recognition && recognition.abort) {
        recognition.abort();
    }
    currentUtteranceQueue = [];
    isSpeakingFullDialogue = false;
    // Stop recording if active when hiding sections
    if (isRecording) {
        if (recognition) recognition.stop();
        isRecording = false;
        const recordBtn = document.getElementById('record-pronunciation-btn');
        if (recordBtn) {
            recordBtn.classList.remove('recording');
            recordBtn.querySelector('span').textContent = 'Ghi âm & Chấm điểm';
        }
    }

    contentResultsArea.innerHTML = '';
    quickSearchResults.innerHTML = '';
    Object.keys(contentContainers).forEach(key => delete contentContainers[key]);
}

function createContentSection(featureKey, headerText) {
    hideAllSections();
    const containerId = `${featureKey}Container`;
    const overlayId = `${featureKey}LoadingOverlay`;
    const contentId = `${featureKey}Content`;

    const sectionHTML = `
        <div class="content-section" id="${containerId}" style="display: block;">
            <div class="loading-overlay" id="${overlayId}">
                <div class="loading-spinner"></div>
                <div class="loading-text">${headerText}...</div>
            </div>
            <div id="${contentId}"></div>
        </div>
    `;
    contentResultsArea.innerHTML = sectionHTML;

    contentContainers[featureKey] = {
        container: document.getElementById(containerId),
        overlay: document.getElementById(overlayId),
        content: document.getElementById(contentId)
    };

    document.getElementById(containerId).scrollIntoView({ behavior: 'smooth', block: 'start' });

    return contentContainers[featureKey];
}

function showMessage(message, type = 'error') {
    messageBox.textContent = message;
    messageBox.className = `message-alert show ${type}`;
}

function hideMessage() {
    messageBox.className = 'message-alert';
}

function clearInput() {
    vocabularyInput.value = '';
    hideMessage();
    vocabularyInput.focus();
    hideAllSections();
}

async function pasteFromClipboard() {
    hideMessage();
    if (!navigator.clipboard?.readText) {
        showMessage('Trình duyệt của bạn không hỗ trợ dán tự động. Vui lòng dùng tổ hợp phím Ctrl+V.', 'error');
        return;
    }
    try {
        const text = await navigator.clipboard.readText();
        vocabularyInput.value = text;
        showMessage('Đã dán thành công!', 'info');
    } catch (err) {
        console.error('Lỗi khi dán:', err);
        showMessage('Dán tự động bị chặn bởi trình duyệt. Vui lòng dùng Ctrl+V hoặc Cmd+V để dán.', 'error');
    }
}

// --- Main Feature Functions ---
function openLink(type) {
    const vocabulary = vocabularyInput.value.trim();
    if (!vocabulary) {
        showMessage('Vui lòng nhập từ vựng để tìm kiếm.', 'error');
        return;
    }
    const urls = {
        googleTranslate: `https://translate.google.com/?sl=en&tl=vi&text=${encodeURIComponent(vocabulary)}&op=translate`,
        oxfordDictionary: `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(vocabulary)}`,
        youglish: `https://youglish.com/pronounce/${encodeURIComponent(vocabulary)}/english/us`,
        googleImages: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(vocabulary)}`
    };
    if (urls[type]) {
        window.open(urls[type], '_blank');
    }
}

async function callGemini(prompt, schema = null, isTextOnly = false) {
    // Luôn lấy API key mới nhất từ localStorage qua getApiKey()
    const apiKey = getApiKey();
    if (!apiKey) {
        showStartupModal('Bạn cần nhập API key để sử dụng!');
        throw new Error('Chưa có API key');
    }
    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    const payload = { contents: chatHistory };
    if (schema && !isTextOnly) {
        payload.generationConfig = {
            responseMimeType: "application/json",
            responseSchema: schema
        };
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("API Error Response:", errorBody);
        throw new Error(`Lỗi API: ${response.status} ${response.statusText}`);
    }
    const result = await response.json();
    if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
        const text = result.candidates[0].content.parts[0].text;
        if (isTextOnly) {
            return text;
        }
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error("Lỗi phân tích JSON:", e, "Dữ liệu gốc:", text);
            throw new Error("Không thể phân tích phản hồi từ API.");
        }
    }
    console.error("Phản hồi API không hợp lệ:", result);
    throw new Error('Cấu trúc phản hồi API không mong đợi hoặc trống.');
}

async function handleFeature(featureKey, headerText, promptGenerator, renderer, inputValidator = (input) => !!input) {
    const { container, content, overlay } = createContentSection(featureKey, `Đang ${headerText.toLowerCase()}`);

    let featureInput;
    // For manual speaking practice, the input is handled via the modal
    if (featureKey === 'speakingPracticeManual') {
        // The actual input (sentences array) will be passed directly from startSpeakingPracticeManual
        featureInput = arguments[arguments.length - 1]; // This is a hacky way to get the last argument, which will be 'sentences'
                                                         // A cleaner way would be to refactor handleFeature to accept a specific data param
    } else {
        featureInput = vocabularyInput.value.trim();
    }

    if (!inputValidator(featureInput)) {
        showMessage(`Vui lòng nhập đầu vào hợp lệ cho chức năng này.`, 'error');
        hideAllSections();
        return;
    }

    try {
        if (['conversationSimulator', 'speakingPractice', 'speakingPracticeManual', 'writingPractice'].includes(featureKey)) {
             // For these specific features, the renderer expects a direct input (like topic or sentences array)
             await renderer(featureInput, content, headerText);
        } else {
            const { prompt, schema } = promptGenerator(featureInput);
            const data = await callGemini(prompt, schema);
            renderer(data, content, headerText);
        }
    } catch (error) {
        showMessage(`Có lỗi xảy ra khi tạo nội dung. Vui lòng thử lại.`, 'error');
        console.error(`Lỗi với chức năng ${featureKey}:`, error);
        content.innerHTML = `<p class="text-red-500 font-semibold">Đã xảy ra lỗi: ${error.message}</p>`;
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}

// --- RENDERERS ---
const renderers = {
     spellCheckSuggestion: (originalWord, correctedWord, el) => {
        el.innerHTML = `
            <div class="info-card p-4 text-center border-yellow-400 bg-yellow-50 dark:bg-yellow-900/50 dark:border-yellow-600">
                <p class="text-yellow-800 dark:text-yellow-200">
                    Ý bạn là: <strong class="text-yellow-900 dark:text-yellow-100 font-bold cursor-pointer hover:underline" onclick="searchWithCorrection('${correctedWord.replace(/'/g, "\\'")}')">${correctedWord}</strong>?
                </p>
                <div class="mt-3">
                     <button class="external-btn" onclick="quickSearch({ bypassSpellCheck: true, wordToSearch: '${originalWord.replace(/'/g, "\\'")}' })">
                        Vẫn tra cứu '${originalWord}'
                     </button>
                </div>
            </div>
        `;
    },
    quickLookup: (data, el) => {
        el.innerHTML = `
            <div class="info-card p-4">
              <div class="flex items-center gap-4">
                 <button class="audio-btn" style="width: 44px; height: 44px; min-width: 44px;" onclick="speakText(vocabularyInput.value)" title="Nghe lại">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-1.414 1.414A6.472 6.472 0 0 1 12.026 8c0 1.966-.893 3.738-2.29 4.949l1.414 1.414z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.026 8a6.48 6.48 0 0 0-1.905-4.596l-1.414 1.414A4.486 4.486 0 0 1 10.026 8c0 1.353-.6 2.544-1.515 3.328l1.414 1.414zM8.707 11.182A4.5 4.5 0 0 0 10.026 8a4.5 4.5 0 0 0-1.319-3.182L8.707 5.18a2.5 2.5 0 0 1 0 5.64l.001.002zM6.343 4.828a.5.5 0 0 0 0 .707L7.05 6.243a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.707L7.757 4.12a.5.5 0 0 0-.707 0l-.708.707zM4.717 6.464a.5.5 0 0 0 0 .708L5.424 7.88a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.708L6.128 5.757a.5.5 0 0 0-.707 0l-.708.707zM2 8a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 2 8z"/></svg>
                 </button>
                 <div>
                    <p class="text-xl font-semibold text-indigo-600 dark:text-indigo-400">${data.ipa}</p>
                    <p class="mt-1 text-lg">${data.meaning}</p>
                 </div>
              </div>
            </div>
        `;
    },
    examples: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">💡 ${headerText}</h2>
            <div class="table-container">
                <table>
                    <thead><tr><th>STT</th><th>Cấu trúc</th><th>Tiếng Anh</th><th>Phát âm</th><th>Tiếng Việt</th></tr></thead>
                    <tbody>
                    ${data.map(item => `
                        <tr>
                            <td class="text-center">${item.STT}</td>
                            <td>${item['Cấu trúc câu']}</td>
                            <td>${item['Ví dụ (tiếng Anh)']}</td>
                            <td class="text-center">
                                <button class="icon-btn" onclick="speakText('${item['Ví dụ (tiếng Anh)'].replace(/'/g, "\\'")}')" title="Nghe">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-1.414 1.414A6.472 6.472 0 0 1 12.026 8c0 1.966-.893 3.738-2.29 4.949l1.414 1.414z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.026 8a6.48 6.48 0 0 0-1.905-4.596l-1.414 1.414A4.486 4.486 0 0 1 10.026 8c0 1.353-.6 2.544-1.515 3.328l1.414 1.414zM8.707 11.182A4.5 4.5 0 0 0 10.026 8a4.5 4.5 0 0 0-1.319-3.182L8.707 5.18a2.5 2.5 0 0 1 0 5.64l.001.002zM6.343 4.828a.5.5 0 0 0 0 .707L7.05 6.243a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.707L7.757 4.12a.5.5 0 0 0-.707 0l-.708.707zM4.717 6.464a.5.5 0 0 0 0 .708L5.424 7.88a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.708L6.128 5.757a.5.5 0 0 0-.707 0l-.708.707zM2 8a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 2 8z"/></svg>
                                </button>
                            </td>
                            <td>${item['Ví dụ (Tiếng Việt)']}</td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },
    exercise: (data, el, headerText) => {
        el.innerHTML = `<h2 class="section-header">✨ ${headerText}</h2>` + data.map(item => `
            <div class="exercise-item">
                <p class="exercise-sentence">${item.id}. ${item.sentence_with_blank}</p>
                <div class="exercise-options">${item.options.map(option => `<button class="option-btn" data-value="${option.replace(/"/g, '&quot;')}" onclick="checkFillInBlankAnswer(this, '${item.correct_word.replace(/'/g, "\\'")}')">${option}</button>`).join('')}</div>
                <p class="exercise-translation">(Dịch: ${item.translation})</p>
                <div class="exercise-feedback"></div>
            </div>`).join('');
    },
    listeningFillInTheBlank: (data, el, headerText) => {
         el.innerHTML = `<h2 class="section-header">🎧 ${headerText}</h2>` + data.map(item => `
            <div class="exercise-item">
                <div class="flex items-center gap-4 mb-4">
                     <button class="audio-btn" onclick="playQuestionAudio(this, '${item.audio_sentence.replace(/'/g, "\\'")}')" title="Nghe câu">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M10.804 8 5 4.633v6.734L10.804 8zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm15 0a7 7 0 1 0-14 0 7 7 0 0 0 14 0z"/></svg>
                     </button>
                     <p class="exercise-sentence flex-1">${item.id}. ${item.sentence_with_blank}</p>
                </div>
                <div class="exercise-options">${item.options.map(option => `<button class="option-btn" data-value="${option.replace(/"/g, '&quot;')}" onclick="checkFillInBlankAnswer(this, '${item.correct_word.replace(/'/g, "\\'")}')">${option}</button>`).join('')}</div>
                <p class="exercise-translation">(Dịch: ${item.translation})</p>
                <div class="exercise-feedback"></div>
            </div>`).join('');
    },
    explanation: (data, el, headerText) => {
        const renderStars = (popularity) => {
            let stars = '';
            for (let i = 1; i <= 5; i++) {
                stars += i <= popularity ? '★' : '☆';
            }
            return `<span class="text-yellow-400">${stars}</span>`;
        };

        const renderTermList = (items) => {
            if (!items || items.length === 0) return '<li>Không có</li>';
            return items.map(item => `
                <li class="flex justify-between items-center py-1">
                    <div>
                        <span class="font-medium">${item.term}</span>
                        <span class="text-gray-500 dark:text-gray-400">(${item.translation})</span>
                    </div>
                    ${renderStars(item.popularity)}
                </li>
            `).join('');
        };

        const meaningsTableHTML = `
            <div class="info-card">
                <h3 class="card-title">📖 Bảng nghĩa</h3>
                <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Nghĩa</th>
                            <th>Cụm từ đi chung (Ví dụ)</th>
                            <th>Mức độ phổ biến</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.meanings_table.map(item => `
                            <tr>
                                <td>${item.meaning}</td>
                                <td><em>${item.example_collocation}</em></td>
                                <td>${renderStars(item.frequency)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                </div>
            </div>
        `;

        const mainDefinitionHTML = `
            <div class="info-card">
                <h3 class="card-title">📘 Định nghĩa chi tiết</h3>
                <p>${data.main_definition}</p>
            </div>
        `;

        el.innerHTML = `
            <h2 class="section-header">📚 ${headerText}: ${data.word}</h2>
            ${meaningsTableHTML}
            ${mainDefinitionHTML}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="info-card">
                    <h3 class="card-title">👍 Từ đồng nghĩa</h3>
                    <ul class="list-none space-y-2">${renderTermList(data.synonyms)}</ul>
                </div>
                <div class="info-card">
                    <h3 class="card-title">👎 Từ trái nghĩa</h3>
                    <ul class="list-none space-y-2">${renderTermList(data.antonyms)}</ul>
                </div>
            </div>
            <div class="info-card">
                <h3 class="card-title">🤝 Cách dùng phổ biến (Collocations)</h3>
                 <ul class="list-none space-y-2">${renderTermList(data.collocations)}</ul>
            </div>
            <div class="info-card">
                <h3 class="card-title">⚠️ Lưu ý cách dùng</h3>
                <p>${data.usage_notes}</p>
            </div>
        `;
    },
    correction: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">✍️ ${headerText}</h2>
            <div class="info-card">
                <p><strong>Câu gốc:</strong> <span class="text-red-500 line-through">${data.original_sentence}</span></p>
                <p class="mt-2"><strong>Câu đã sửa:</strong> <span class="text-green-600 font-semibold">${data.corrected_sentence}</span></p>
            </div>
            <div class="info-card">
                <h3 class="card-title">🔄 Các thay đổi:</h3>
                <ul class="list-disc list-inside">${data.changes.map(change => `<li>${change}</li>`).join('')}</ul>
            </div>
             <div class="info-card">
                <h3 class="card-title">🇻🇳 Dịch nghĩa:</h3>
                <p>${data.translation}</p>
            </div>`;
    },
    dialogue: (data, el, headerText) => {
        const characterAlignments = new Map();
        let nextAlignment = 'left';

        const getAlignment = (character) => {
            if (!characterAlignments.has(character)) {
                characterAlignments.set(character, nextAlignment);
                nextAlignment = (nextAlignment === 'left') ? 'right' : 'left';
            }
            return characterAlignments.get(character);
        };

        const allEnglishLines = data.map(line => line.english_line);

        el.innerHTML = `
            <h2 class="section-header flex justify-between items-center">
                <span>💬 ${headerText}</span>
                <button id="playFullDialogueBtn" class="primary-btn text-sm px-3 py-1.5" title="Phát âm toàn bộ đoạn hội thoại">
                     <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M10.804 8 5 4.633v6.734L10.804 8zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm15 0a7 7 0 1 0-14 0 7 7 0 0 0 14 0z"/></svg>
                     Phát âm toàn bộ
                </button>
            </h2>
            <div class="flex flex-col gap-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50">
            ${data.map((line) => {
                const alignment = getAlignment(line.character);
                const isLeft = alignment === 'left';

                const alignmentClasses = isLeft
                    ? 'bg-white dark:bg-slate-700 rounded-bl-none'
                    : 'bg-indigo-50 dark:bg-indigo-950 rounded-br-none';

                const mainTextColor = 'text-slate-800 dark:text-slate-200';
                const translationTextColor = 'text-slate-500 dark:text-slate-400';

                const characterColor = isLeft
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-indigo-600 dark:text-indigo-400';

                return `
                <div class="w-full flex ${isLeft ? 'justify-start' : 'justify-end'}">
                    <div class="p-3 rounded-xl max-w-xl ${alignmentClasses} shadow-sm border border-black/5 dark:border-white/5">
                        <div class="flex items-start gap-3">
                             <div class="flex-grow">
                                <strong class="${characterColor} font-bold block">${line.character}</strong>
                                <p class="${mainTextColor} mt-1">${line.english_line}</p>
                            </div>
                            <button class="icon-btn flex-shrink-0 -mt-1 -mr-1" onclick="speakText('${line.english_line.replace(/'/g, "\\'")}')" title="Nghe câu này">
                               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"> <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-1.414 1.414A6.472 6.472 0 0 1 12.026 8c0 1.966-.893 3.738-2.29 4.949l1.414 1.414z"/> <path d="M10.121 12.596A6.48 6.48 0 0 0 12.026 8a6.48 6.48 0 0 0-1.905-4.596l-1.414 1.414A4.486 4.486 0 0 1 10.026 8c0 1.353-.6 2.544-1.515 3.328l1.414 1.414zM8.707 11.182A4.5 4.5 0 0 0 10.026 8a4.5 4.5 0 0 0-1.319-3.182L8.707 5.18a2.5 2.5 0 0 1 0 5.64l.001.002zM6.343 4.828a.5.5 0 0 0 0 .707L7.05 6.243a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.707L7.757 4.12a.5.5 0 0 0-.707 0l-.708.707zM4.717 6.464a.5.5 0 0 0 0 .708L5.424 7.88a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.708L6.128 5.757a.5.5 0 0 0-.707 0l-.708.707zM2 8a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 2 8z"/> </svg>
                            </button>
                        </div>
                        <p class="text-sm ${translationTextColor} italic mt-2">(Dịch: ${line.vietnamese_line})</p>
                    </div>
                </div>`;
            }).join('')}
            </div>`;

        document.getElementById('playFullDialogueBtn').addEventListener('click', () => {
            playFullDialogue(allEnglishLines);
        });
    },
    summary: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">📋 ${headerText}</h2>
            <div class="info-card"><p class="leading-relaxed">${data.summary.replace(/\n/g, '<br>')}</p></div>`;
    },
    paragraphs: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">📄 ${headerText}</h2>
            <div class="info-card">
                <h3 class="card-title-alt">📝 English Paragraph:</h3>
                <p>${data.english_paragraph}</p>
            </div>
            <div class="info-card">
                <h3 class="card-title-alt">📖 Bản dịch tiếng Việt:</h3>
                <p>${data.vietnamese_translation}</p>
            </div>
            <div class="info-card">
                <h3 class="card-title-alt">📖 Bản dịch hỗn hợp (Anh-Việt):</h3>
                <p>${data.mixed_vietnamese_translation}</p>
            </div>
            <div class="info-card">
                <h3 class="card-title-alt">🗣️ Từ vựng đã sử dụng:</h3>
                <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>STT</th>
                            <th>Từ vựng</th>
                            <th>Nghĩa</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.vocabulary_list.map((item, index) => `<tr><td>${index + 1}</td><td>${item.word}</td><td>${item.meaning}</td></tr>`).join('')}
                    </tbody>
                </table>
                </div>
            </div>`;
    },
    popularity: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">📊 ${headerText}</h2>
             <div class="table-container">
            <table>
                <thead><tr><th>Từ/Cụm từ</th><th>Mức độ</th><th>Bản dịch</th><th>Ngữ cảnh</th></tr></thead>
                <tbody>
                    <tr>
                        <td class="font-bold text-lg text-indigo-600 dark:text-indigo-400">${data.original_item}</td>
                        <td><span class="font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${data.popularity_status}</span></td>
                        <td>${data.translation}</td>
                        <td>${data.context_explanation}</td>
                    </tr>
                    ${(data.suggested_alternatives && data.suggested_alternatives.length > 0) ? data.suggested_alternatives.map(alt => `
                        <tr>
                            <td class="font-semibold">${alt.alternative_item}</td>
                            <td><span class="font-medium px-2 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200">${alt.popularity_status}</span></td>
                            <td>${alt.translation}</td>
                            <td>${alt.context_explanation}</td>
                        </tr>`).join('') : ''
                    }
                </tbody>
            </table>
            </div>`;
    },
    reading: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">📖 ${headerText}</h2>
            <div class="info-card">
                <h3 class="card-title">📝 Bài đọc</h3>
                <div class="prose max-w-none dark:text-gray-300">${data.reading_passage.replace(/\n/g, '<br>')}</div>
            </div>
            <h3 class="card-title mt-6">❓ Câu hỏi</h3>` +
            data.questions.map(q => `
            <div class="question-item" data-correct-answer="${q.correct_option.replace(/"/g, '&quot;')}" data-question-translation="${q.question_translation.replace(/"/g, '&quot;')}">
                <p class="question-text">${q.id}. ${q.question_text}</p>
                <div class="question-options">${q.options.map(opt => `<button class="option-btn" onclick="checkMultipleChoiceAnswer(this)">${opt}</button>`).join('')}</div>
                <div class="question-feedback"></div>
            </div>`).join('');
    },
    listening: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">🎧 ${headerText}</h2>
            <div class="info-card mb-4">
                <div id="audioPlayerContainer"></div>
                <div class="flex justify-center mt-4">
                   <button id="toggleTranscriptBtn" class="transcript-toggle-btn">📜 Hiện văn bản</button>
                </div>
            </div>
            <div id="transcriptContent" class="info-card hidden">
                <h3 class="card-title">📝 Văn bản bài nghe</h3>
                <div class="prose max-w-none dark:text-gray-300 p-2">${data.audio_script.replace(/\n/g, '<br>')}</div>
                <h3 class="card-title-alt mt-4">📖 Bản dịch</h3>
                <div class="prose max-w-none dark:text-gray-400 p-2">${data.audio_script_translation.replace(/\n/g, '<br>')}</div >
            </div>
            <h3 class="card-title-alt mt-6">❓ Câu hỏi</h3>` +
            data.questions.map(q => `
            <div class="question-item" data-correct-answer="${q.correct_option.replace(/"/g, '&quot;')}" data-question-translation="${q.question_text_translation.replace(/"/g, '&quot;')}" >
                <p class="question-text">${q.id}. ${q.question_text}</p>
                <div class="question-options">${q.options.map(opt => `<button class="option-btn" onclick="checkMultipleChoiceAnswer(this)">${opt}</button>`).join('')}</div>
                <div class="question-feedback"></div>
            </div>`).join('');

        setupAudioPlayer(data.audio_script, document.getElementById('audioPlayerContainer'));

        const toggleBtn = document.getElementById('toggleTranscriptBtn');
        const transcriptContent = document.getElementById('transcriptContent');
        toggleBtn.addEventListener('click', () => {
            const isHidden = transcriptContent.classList.toggle('hidden');
            toggleBtn.innerHTML = isHidden ? '📜 Hiện văn bản' : '📜 Ẩn văn bản';
        });
    },
    conversationSimulator: async (scenario, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">🗣️ ${headerText}: ${scenario}</h2>
            <div class="conversation-container">
                <div class="message-area" id="messageArea"></div>
                <div class="chat-input-container">
                    <input type="text" id="chatInput" class="chat-input" placeholder="Nhập câu trả lời của bạn...">
                    <button id="chatSendButton" class="chat-send-btn">Gửi</button>
                </div>
            </div>
            <div id="unusedWordsSection" class="unused-words-section">
                <h3 class="card-title">Gợi ý từ vựng:</h3>
                <p id="unusedWordsList"></p>
            </div>`;

        const chatInput = document.getElementById('chatInput');
        const chatSendButton = document.getElementById('chatSendButton');

        const handleSend = () => continueConversation(scenario);
        chatSendButton.addEventListener('click', handleSend);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        await initializeUnusedWords(scenario);

        const systemPrompt = `You are a helpful AI assistant named Alex, designed for English learners. Your task is to role-play a scenario. The current scenario is: '${scenario}'. Start the conversation naturally. Keep your responses friendly, encouraging, and not too long. Provide your English response and its Vietnamese translation in JSON format: {"english": "Your English response", "vietnamese": "Bản dịch tiếng Việt của bạn"}.`;
        conversationHistory = [{ role: 'user', parts: [{ text: systemPrompt }] }];

        await getNextAiResponse();
    },
    idiom: (data, el, headerText) => {
         el.innerHTML = `
            <h2 class="section-header">🌟 ${headerText}: ${data.idiom}</h2>
            <div class="info-card">
                <p><strong>Nghĩa đen:</strong> ${data.literal_translation || "Không có"}</p>
                <p class="mt-2"><strong>Nghĩa bóng (Ý nghĩa thật):</strong> ${data.meaning}</p>
            </div>
            <div class="info-card">
                <h3 class="card-title">🌍 Nguồn gốc & cách dùng</h3>
                <p>${data.origin}</p>
            </div>
            <div class="info-card">
                <h3 class="card-title">💡 Ví dụ</h3>
                <ul class="list-disc list-inside space-y-3">${data.examples.map(ex => `<li><strong>EN:</strong> "${ex.english}"<br><span class="text-gray-500 dark:text-gray-400"><strong>VN:</strong> "${ex.vietnamese}"</span></li>`).join('')}</ul>
            </div>`;
    },
    comparison: (data, el, headerText) => {
         el.innerHTML = `
            <h2 class="section-header">⚖️ ${headerText}</h2>
            <div class="table-container">
                <table>
                    <thead><tr><th>Từ</th><th>Giải thích</th><th>Ví dụ</th><th>Nghĩa ví dụ</th></tr></thead>
                    <tbody>
                    ${data.map(item => `
                        <tr>
                            <td class="font-bold text-lg text-indigo-600 dark:text-indigo-400">${item.word}</td>
                            <td>${item.explanation}</td>
                            <td><em>"${item.example_sentence}"</em></td>
                            <td><em>${item.example_translation}</em></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },
    emailDrafter: (data, el, headerText) => {
        el.innerHTML = `<h2 class="section-header">📧 ${headerText}: ${data.purpose}</h2>` +
        data.drafts.map(draft => `
            <div class="info-card">
                <h3 class="card-title"><span class="font-medium px-3 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${draft.tone}</span></h3>
                <pre class="whitespace-pre-wrap font-sans leading-relaxed">${draft.body}</pre>
            </div>
        `).join('');
    },
    imageGenerator: (imageUrl, el, headerText, prompt) => {
        // ĐÃ XOÁ RENDERER TẠO ẢNH
    },
    tone: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">🎭 ${headerText}</h2>
            <div class="info-card">
                <h3 class="card-title">Câu gốc</h3>
                <p class="italic">"${data.original_sentence}"</p>
            </div>
            <div class="info-card">
                <h3 class="card-title">Giọng điệu được phát hiện</h3>
                <p><span class="font-medium px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200">${data.tone}</span></p>
                <p class="mt-2">${data.explanation}</p>
            </div>
             ${(data.suggestions && data.suggestions.length > 0) ? `
             <div class="info-card">
                <h3 class="card-title"> Gợi ý điều chỉnh</h3>
                <ul class="list-disc list-inside space-y-2">
                    ${data.suggestions.map(s => `<li><strong>${s.new_tone}:</strong> ${s.rewritten_sentence}</li></li>`).join('')}
                </ul>
             </div>` : ''}
        `;
    },
    translationResults: (data, el, headerText) => {
        el.innerHTML = `
            <h2 class="section-header">🔁 ${headerText}</h2>
             <div class="table-container">
            <table>
                <thead><tr><th>Bản dịch Tiếng Anh</th><th>Mức độ phổ biến</th><th>Ghi chú sử dụng</th></tr></thead>
                <tbody>
                    ${data.map(item => `
                        <tr>
                            <td class="font-semibold">${item.english_translation}</td>
                            <td><span class="font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${item.popularity_status}</span></td>
                            <td>${item.usage_note}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    },
    speakingPractice: async (topic, el, headerText) => {
         const { prompt, schema } = prompts.speakingPractice(topic);
         const data = await callGemini(prompt, schema);
         // Pass the array of sentences to renderSpeakingPracticeUI, even if it's just one for AI mode initially
         renderSpeakingPracticeUI(el, [data.vietnamese_sentence], topic, 'ai');
    },
    speakingPracticeManual: (input, el, headerText) => {
        // 'input' here is the array of sentences from the modal for manual mode
        renderSpeakingPracticeUI(el, input, '', 'manual'); // Pass the sentences array
    },
    writingPractice: async (topic, el, headerText) => {
         const { prompt, schema } = prompts.writingPractice(topic);
         const data = await callGemini(prompt, schema);
         renderWritingPracticeUI(el, data, topic);
    },
};

// New helper function to highlight differences
function highlightDifferences(target, spoken) {
    const targetWords = target.toLowerCase().split(/\s+/).filter(w => w);
    const spokenWords = spoken.toLowerCase().split(/\s+/).filter(w => w);

    let highlightedSpoken = [];
    // Use a simple comparison for highlighting. More advanced diffing algorithms could be used.
    for (let i = 0; i < Math.max(targetWords.length, spokenWords.length); i++) {
        const targetWord = targetWords[i];
        const spokenWord = spokenWords[i];

        if (spokenWord === undefined) {
            // If spoken text is shorter than target, remaining target words are implicitly "missing"
            // We don't highlight missing words in the spoken text, only what was said incorrectly.
            break;
        } else if (targetWord === undefined) {
            // If spoken text is longer than target, extra words in spoken text are incorrect
            highlightedSpoken.push(`<span class="text-red-500 font-bold">${spokenWord}</span>`);
        } else if (targetWord === spokenWord) {
            highlightedSpoken.push(spokenWord);
        } else {
            highlightedSpoken.push(`<span class="text-red-500 font-bold">${spokenWord}</span>`);
        }
    }
    return highlightedSpoken.join(' ');
}


function renderSpeakingPracticeUI(el, initialSentences, topic, mode) {
    let sentences = initialSentences; // This will be an array of sentences
    let currentIndex = 0;
    let currentSuggestions = [];
    let currentVietnameseSentence = sentences[currentIndex]; // Initialize with the first sentence

    el.innerHTML = `
        <h2 class="section-header">🎙️ Luyện phản xạ nói ${mode === 'manual' ? '(Thủ công)' : '(AI)'}</h2>
        <div id="speaking-practice-card" class="info-card text-center relative speaking-practice-card">
            <p class="text-2xl font-semibold" id="vietnamese-sentence-display"></p>
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" id="speaking-practice-loader" style="display:none;">
                <div class="loading-spinner"></div>
            </div>
        </div>
        <div class="flex justify-center items-center gap-4 mt-4 practice-actions">
            <button id="new-sentence-btn" class="feature-btn">🔄 Câu khác</button>
            <button id="show-answer-btn" class="primary-btn">💡 Hiện gợi ý</button>
            <button id="record-pronunciation-btn" class="pronunciation-record-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V3z"/><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5z"/></svg>
                <span>Ghi âm & Chấm điểm</span>
            </button>
        </div>
        <div id="answer-container" class="mt-6 hidden"></div>
        <div id="pronunciation-score-container" class="mt-6 hidden"></div>
        `;

    const sentenceDisplay = document.getElementById('vietnamese-sentence-display');
    const answerContainer = document.getElementById('answer-container');
    const newSentenceBtn = document.getElementById('new-sentence-btn');
    const showAnswerBtn = document.getElementById('show-answer-btn');
    const recordBtn = document.getElementById('record-pronunciation-btn');
    const scoreContainer = document.getElementById('pronunciation-score-container');
    const loader = document.getElementById('speaking-practice-loader');

    const fetchAndSetSuggestions = async (vietnameseSentence) => {
        try {
            showAnswerBtn.disabled = true;
            showAnswerBtn.innerHTML = `<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>`;
            const { prompt, schema } = prompts.speakingPracticeSingle(vietnameseSentence);
            const suggestionData = await callGemini(prompt, schema);
            currentSuggestions = suggestionData.suggestions;

            let answerHTML = `<div class="table-container"><h3 class="card-title">Gợi ý trả lời</h3><table><thead><tr><th>Gợi ý (Tiếng Anh)</th><th>Mức độ phổ biến</th></tr></thead><tbody>`;
            currentSuggestions.forEach(s => {
                answerHTML += `<tr><td>${s.translation}</td><td><span class="font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${s.popularity}</span></td></tr>`;
            });
            answerHTML += `</tbody></table></div>`;
            answerContainer.innerHTML = answerHTML;
            answerContainer.classList.remove('hidden');
            showAnswerBtn.textContent = '🙈 Ẩn gợi ý';
        } catch (e) {
            answerContainer.innerHTML = `<p class="text-red-500">Không thể tải gợi ý.</p>`;
            showAnswerBtn.textContent = '💡 Hiện gợi ý';
        } finally {
            showAnswerBtn.disabled = false;
        }
    };

    const displaySentence = (sentence) => {
        currentVietnameseSentence = sentence; // Update global current Vietnamese sentence
        sentenceDisplay.textContent = sentence;
        answerContainer.innerHTML = '';
        answerContainer.classList.add('hidden');
        scoreContainer.innerHTML = '';
        scoreContainer.classList.add('hidden');
        showAnswerBtn.textContent = '💡 Hiện gợi ý';
        showAnswerBtn.disabled = false;
        currentSuggestions = [];
    };

    const showNextSentence = async () => {
        newSentenceBtn.disabled = true;
        loader.style.display = 'block';
        sentenceDisplay.style.opacity = '0.3';

        if (mode === 'ai') {
            const { prompt, schema } = prompts.speakingPractice(topic);
            const data = await callGemini(prompt, schema);
            displaySentence(data.vietnamese_sentence);
        } else {
            // Manual mode: Cycle through the provided sentences
            currentIndex = (currentIndex + 1) % sentences.length;
            displaySentence(sentences[currentIndex]);
        }

        loader.style.display = 'none';
        sentenceDisplay.style.opacity = '1';
        newSentenceBtn.disabled = false;
    };

    showAnswerBtn.addEventListener('click', () => {
        if (answerContainer.classList.contains('hidden')) {
            fetchAndSetSuggestions(currentVietnameseSentence); // Use the global currentVietnameseSentence
        } else {
            answerContainer.classList.add('hidden');
            showAnswerBtn.textContent = '💡 Hiện gợi ý';
        }
    });

    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            // If recording, stop it
            if (recognition) recognition.stop();
        } else {
            // If not recording, start it
            handlePronunciationRecording(currentVietnameseSentence, currentSuggestions);
        }
    });

    newSentenceBtn.addEventListener('click', showNextSentence);

    displaySentence(currentVietnameseSentence); // Initial display
}

function renderWritingPracticeUI(el, initialData, topic) {
    el.innerHTML = `
        <h2 class="section-header">✍️ Luyện viết (AI)</h2>
        <div class="info-card">
            <h3 class="card-title">Dịch câu sau sang tiếng Anh:</h3>
            <p id="vietnamese-writing-prompt" class="text-xl font-semibold text-center py-4"></p>
        </div>
        <textarea id="english-writing-input" class="textarea-input" placeholder="Viết câu trả lời của bạn ở đây..."></textarea>
        <div id="writing-feedback-container" class="mt-4"></div>
        <div class="flex justify-center gap-4 mt-4 practice-actions">
             <button id="check-writing-btn" class="primary-btn">✔️ Kiểm tra</button>
             <button id="hint-writing-btn" class="feature-btn">💡 Gợi ý</button>
             <button id="next-writing-btn" class="feature-btn">🔄 Câu khác</button>
        </div>
    `;

    const promptDisplay = document.getElementById('vietnamese-writing-prompt');
    const inputArea = document.getElementById('english-writing-input');
    const feedbackContainer = document.getElementById('writing-feedback-container');
    const checkBtn = document.getElementById('check-writing-btn');
    const hintBtn = document.getElementById('hint-writing-btn');
    const nextBtn = document.getElementById('next-writing-btn');

    const fetchNewSentence = async () => {
        feedbackContainer.innerHTML = '';
        inputArea.value = '';
        promptDisplay.textContent = 'Đang tải câu mới...';
        const { prompt, schema } = prompts.writingPractice(topic);
        const data = await callGemini(prompt, schema);
        promptDisplay.textContent = data.vietnamese_sentence;
        checkBtn.disabled = false;
        hintBtn.disabled = false;
    };

    hintBtn.addEventListener('click', async () => {
         const currentSentence = promptDisplay.textContent;
         feedbackContainer.innerHTML = 'Đang tải gợi ý...';
         const { prompt, schema } = prompts.speakingPracticeSingle(currentSentence);
         const data = await callGemini(prompt, schema);
         let answerHTML = `<div class="info-card table-container"><h3 class="card-title">Gợi ý trả lời</h3><table><thead><tr><th>Gợi ý (Tiếng Anh)</th><th>Mức độ phổ biến</th></tr></thead><tbody>`;
         data.suggestions.forEach(s => {
             answerHTML += `<tr><td>${s.translation}</td><td><span class="font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${s.popularity}</span></td></tr>`;
         });
         answerHTML += `</tbody></table></div>`;
         feedbackContainer.innerHTML = answerHTML;
    });

    checkBtn.addEventListener('click', async () => {
        const vietnameseSentence = promptDisplay.textContent;
        const userEnglish = inputArea.value.trim();

        if (!userEnglish) {
            showMessage("Vui lòng nhập câu trả lời của bạn.", 'error');
            return;
        }

        checkBtn.disabled = true;
        hintBtn.disabled = true;
        feedbackContainer.innerHTML = 'Đang kiểm tra...';

        const { prompt, schema } = prompts.checkTranslation(vietnameseSentence, userEnglish);
        const result = await callGemini(prompt, schema);

        let resultHTML;
        if(result.is_correct) {
            resultHTML = `
                <div class="info-card border-green-500 bg-green-50 dark:bg-green-900/50 dark:border-green-700">
                    <h3 class="card-title text-green-700 dark:text-green-300">🎉 Chính xác!</h3>
                    <p>Câu trả lời của bạn rất tốt.</p>
                    <div class="flex justify-center mt-4"><button onclick="this.closest('#writing-feedback-container').innerHTML='';document.getElementById('next-writing-btn').click()" class="feature-btn">Tiếp tục</button></div>
                </div>
            `;
        } else {
             resultHTML = `
                 <div class="info-card border-red-500 bg-red-50 dark:bg-red-900/50 dark:border-red-700">
                    <h3 class="card-title text-red-700 dark:text-red-300">� Cần xem lại!</h3>
                    <p><strong>Câu của bạn:</strong> <span class="line-through">${result.original_sentence}</span></p>
                    <p class="mt-2"><strong>Câu đã sửa:</strong> <span class="font-semibold text-green-600 dark:text-green-400">${result.corrected_sentence}</span></p>
                    <h4 class="card-title-alt mt-4">Các thay đổi:</h4>
                    <ul class="list-disc list-inside">${result.changes.map(change => `<li>${change}</li>`).join('')}</ul>
                    <div class="flex justify-center mt-4"><button onclick="this.closest('#writing-feedback-container').innerHTML='';document.getElementById('next-writing-btn').click()" class="feature-btn">Tiếp tục</button></div>
                </div>`;
        }
        feedbackContainer.innerHTML = resultHTML;
    });

    nextBtn.addEventListener('click', fetchNewSentence);

    promptDisplay.textContent = initialData.vietnamese_sentence;
}

// --- PROMPTS ---
const prompts = {
    spellCheck: (input) => ({
        prompt: `Check if the English word or phrase "${input}" is spelled correctly. If it's incorrect, provide the most likely correct spelling. The word should be considered correct if it's a proper noun or common slang. Return a JSON object with keys "is_correct" (boolean) and "corrected_word" (string, which is the suggestion if incorrect, or the original word if correct).`,
        schema: { type: "OBJECT", properties: { is_correct: { type: "BOOLEAN" }, corrected_word: { type: "STRING" } }, required: ["is_correct", "corrected_word"] }
    }),
    quickLookup: (input) => ({
        prompt: `For the English word or phrase "${input}", provide its simple Vietnamese meaning and its IPA transcription. Return a JSON object with keys "meaning" and "ipa".`,
        schema: { type: "OBJECT", properties: { ipa: { type: "STRING" }, meaning: { type: "STRING" } }, required: ["ipa", "meaning"] }
    }),
    pronunciationScore: (targetSentence, spokenText) => ({
        prompt: `Compare the spoken text "${spokenText}" against the target English sentence "${targetSentence}". Provide a similarity score from 0 to 100 representing pronunciation accuracy, and a brief feedback comment in Vietnamese. Return JSON with keys "score" (number) and "feedback" (string).`,
        schema: { type: "OBJECT", properties: { score: { type: "NUMBER" }, feedback: { type: "STRING" } }, required: ["score", "feedback"] }
    }),
    examples: (input) => ({ prompt: `Tạo 10-15 câu ví dụ tiếng Anh và bản dịch tiếng Việt cho từ hoặc cụm từ "${input}" với các cấu trúc câu đa dạng. Trả về dưới dạng mảng JSON với các thuộc tính: "STT", "Cấu trúc câu", "Ví dụ (tiếng Anh)", "Ví dụ (Tiếng Việt)".`, schema: { type: "ARRAY", items: { type: "OBJECT", properties: { "STT": { "type": "NUMBER" }, "Cấu trúc câu": { "type": "STRING" }, "Ví dụ (tiếng Anh)": { "type": "STRING" }, "Ví dụ (Tiếng Việt)": { "type": "STRING" } }, required: ["STT", "Cấu trúc câu", "Ví dụ (tiếng Anh)", "Ví dụ (Tiếng Việt)"] } } }),
    exercise: (input) => ({ prompt: `Tạo 10 câu bài tập điền vào chỗ trống cho từ/chủ đề tiếng Anh "${input}". Mỗi câu, cung cấp câu với "____", từ đúng, 4 lựa chọn ngẫu nhiên (bao gồm đáp án đúng), và bản dịch tiếng Việt. Trả về mảng JSON với các thuộc tính: "id", "sentence_with_blank", "correct_word", "options", "translation".`, schema: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "NUMBER" }, sentence_with_blank: { type: "STRING" }, correct_word: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, translation: { type: "STRING" } }, required: ["id", "sentence_with_blank", "correct_word", "options", "translation"] } } }),
    listeningFillInTheBlank: (input) => ({ prompt: `Tạo 5 câu bài tập nghe và điền vào chỗ trống cho từ/chủ đề tiếng Anh "${input}". Mỗi câu phải có: câu tiếng Anh đầy đủ để phát âm, câu đó với một từ được thay bằng "____", từ đúng, 4 lựa chọn ngẫu nhiên (bao gồm đáp án đúng), và bản dịch tiếng Việt của câu đầy đủ. Trả về mảng JSON với các thuộc tính: "id", "audio_sentence", "sentence_with_blank", "correct_word", "options", "translation".`, schema: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "NUMBER" }, audio_sentence: { type: "STRING" }, sentence_with_blank: { type: "STRING" }, correct_word: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, translation: { type: "STRING" } }, required: ["id", "audio_sentence", "sentence_with_blank", "correct_word", "options", "translation"] } } }),
    explanation: (input) => ({ prompt: `Cung cấp giải thích từ vựng chuyên sâu cho từ tiếng Anh "${input}". Trả về một đối tượng JSON với các thuộc tính sau: 'word' (từ gốc), 'meanings_table' (một mảng các đối tượng, mỗi đối tượng có 'meaning' - định nghĩa ngắn gọn bằng tiếng Việt, 'frequency' - mức độ phổ biến từ 1 đến 5, và 'example_collocation' - một cụm từ ví dụ), 'main_definition' (định nghĩa chính, chi tiết bằng tiếng Việt), 'synonyms' (mảng các đối tượng có 'term' - từ đồng nghĩa tiếng Anh, 'translation' - bản dịch tiếng Việt, 'popularity' - mức độ phổ biến từ 1-5), 'antonyms' (tương tự synonyms), 'collocations' (tương tự synonyms), 'usage_notes' (lưu ý sử dụng bằng tiếng Việt).`, schema: { type: "OBJECT", properties: { word: { "type": "STRING" }, meanings_table: { type: "ARRAY", items: { type: "OBJECT", properties: { meaning: { "type": "STRING" }, frequency: { "type": "NUMBER" }, example_collocation: { "type": "STRING" } }, required: ["meaning", "frequency", "example_collocation"] } }, main_definition: { "type": "STRING" }, synonyms: { type: "ARRAY", items: { type: "OBJECT", properties: { term: { "type": "STRING" }, translation: { "type": "STRING" }, popularity: { "type": "NUMBER" } }, required: ["term", "translation", "popularity"] } }, antonyms: { type: "ARRAY", items: { type: "OBJECT", properties: { term: { "type": "STRING" }, translation: { "type": "STRING" }, popularity: { "type": "NUMBER" } }, required: ["term", "translation", "popularity"] } }, collocations: { type: "ARRAY", items: { type: "OBJECT", properties: { term: { "type": "STRING" }, translation: { "type": "STRING" }, popularity: { "type": "NUMBER" } }, required: ["term", "translation", "popularity"] } }, usage_notes: { "type": "STRING" } }, required: ["word", "meanings_table", "main_definition", "synonyms", "antonyms", "collocations", "usage_notes"] } }),
    correction: (input) => ({ prompt: `Sửa lỗi câu tiếng Anh sau: "${input}". Cung cấp câu gốc, phiên bản đã sửa, danh sách các thay đổi (giải thích ngắn gọn từng lỗi BẰNG TIẾNG VIỆT), và bản dịch tiếng Việt của câu đã sửa. Trả về đối tượng JSON với các khóa: "original_sentence", "corrected_sentence", "changes" (mảng các chuỗi TIẾNG VIỆT), "translation".`, schema: { type: "OBJECT", properties: { original_sentence: { type: "STRING" }, corrected_sentence: { type: "STRING" }, changes: { type: "ARRAY", items: { type: "STRING" } }, translation: { type: "STRING" } }, required: ["original_sentence", "corrected_sentence", "changes", "translation"] } }),
    dialogue: (input) => ({ prompt: `Tạo một đoạn hội thoại tiếng Anh tự nhiên (khoảng 15-20 dòng) về chủ đề "${input}" với ít nhất hai nhân vật. Cung cấp tên nhân vật, lời thoại tiếng Anh và bản dịch tiếng Việt cho mỗi dòng. Trả về mảng JSON các đối tượng có khóa: "character", "english_line", "vietnamese_line".`, schema: { type: "ARRAY", items: { type: "OBJECT", properties: { character: { type: "STRING" }, english_line: { type: "STRING" }, vietnamese_line: { type: "STRING" } }, required: ["character", "english_line", "vietnamese_line"] } } }),
    summary: (input) => ({ prompt: `Tóm tắt văn bản tiếng Anh sau đây thành tiếng Việt một cách ngắn gọn, tập trung vào các ý chính: "${input}". Trả về một đối tượng JSON với một khóa duy nhất "summary".`, schema: { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] } }),
    paragraphs: (input) => ({ prompt: `Sử dụng các từ vựng sau đây: "${input}", hãy thực hiện các yêu cầu sau: 1. Viết một đoạn văn tiếng Anh tự nhiên, logic, trình độ A1-B1 , sử dụng TẤT CẢ các từ vựng đã cho. Trong đoạn văn, hãy bôi đậm (dùng thẻ <b>) mỗi từ vựng khi nó xuất hiện. 2. Dịch toàn bộ đoạn văn tiếng Anh đó sang tiếng Việt. 3. Tạo một phiên bản dịch "hỗn hợp": lấy bản dịch tiếng Việt ở bước 2, nhưng thay thế các từ đã dịch bằng TỪ VỰNG GỐC TIẾNG ANH được tô đậm. 4. Liệt kê lại danh sách các từ vựng đã dùng, mỗi từ kèm theo nghĩa tiếng Việt của nó. Trả về một đối tượng JSON với các khóa: "english_paragraph" (string), "vietnamese_translation" (string), "mixed_vietnamese_translation" (string), và "vocabulary_list" (mảng các đối tượng, mỗi đối tượng có 'word' và 'meaning').`, schema: { type: "OBJECT", properties: { english_paragraph: { type: "STRING" }, vietnamese_translation: { type: "STRING" }, mixed_vietnamese_translation: { type: "STRING" }, vocabulary_list: { type: "ARRAY", items: { type: "OBJECT", properties: { word: { type: "STRING" }, meaning: { type: "STRING" } }, required: ["word", "meaning"] } } }, required: ["english_paragraph", "vietnamese_translation", "mixed_vietnamese_translation", "vocabulary_list"] } }),
    popularity: (input) => ({ prompt: `Phân tích mức độ phổ biến của từ/cụm từ tiếng Anh "${input}". Cung cấp trạng thái của nó ("Rất phổ biến", "Phổ biến", "Ít phổ biến", "Không tự nhiên"), bản dịch, và giải thích ngữ cảnh sử dụng. Nếu không phổ biến, đề xuất 2-3 phương án thay thế tốt hơn. Trả về đối tượng JSON có khóa: "original_item", "popularity_status", "translation", "context_explanation", "suggested_alternatives" (mảng các đối tượng có các khóa tương tự).`, schema: { type: "OBJECT", properties: { original_item: { type: "STRING" }, popularity_status: { type: "STRING" }, translation: { type: "STRING" }, context_explanation: { type: "STRING" }, suggested_alternatives: { type: "ARRAY", items: { type: "OBJECT", properties: { alternative_item: { type: "STRING" }, popularity_status: { type: "STRING" }, translation: { type: "STRING" }, context_explanation: { type: "STRING" } } } } }, required: ["original_item", "popularity_status", "translation", "context_explanation"] } }),
    reading: (input) => ({ prompt: `Tạo một bài đọc hiểu tiếng Anh (khoảng 150-200 từ, trình độ A2-B1) về chủ đề "${input}". Sau đó, tạo 5 câu hỏi trắc nghiệm. Mỗi câu hỏi có 4 lựa chọn và chỉ một đáp án đúng. Trả về JSON với các thuộc tính: "reading_passage" (string), "questions" (mảng 5 đối tượng), mỗi đối tượng chứa: "id" (số), "question_text" (string), "question_translation" (string), "options" (mảng 4 string), và "correct_option" (string của đáp án đúng).`, schema: { type: "OBJECT", properties: { reading_passage: { type: "STRING" }, questions: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "NUMBER" }, question_text: { type: "STRING" }, question_translation: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, correct_option: { type: "STRING" } }, required: ["id", "question_text", "question_translation", "options", "correct_option"] } } }, required: ["reading_passage", "questions"] } }),
    listening: (input) => ({ prompt: `Tạo một kịch bản nghe tiếng Anh (khoảng 100-150 từ, trình độ A2-B1, tốc độ nói tự nhiên) về chủ đề "${input}". Sau đó, dịch kịch bản đó sang tiếng Việt. Tiếp theo, tạo 5 câu hỏi trắc nghiệm dựa trên nội dung bài nghe. Mỗi câu hỏi có 4 lựa chọn và chỉ một đáp án đúng. Trả về JSON với các thuộc tính: "audio_script" (string), "audio_script_translation" (string), "questions" (mảng 5 đối tượng), mỗi đối tượng chứa: "id" (số), "question_text" (string), "question_text_translation" (string), "options" (mảng 4 string), và "correct_option" (string của đáp án đúng).`, schema: { type: "OBJECT", properties: { audio_script: { type: "STRING" }, audio_script_translation: { type: "STRING" }, questions: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "NUMBER" }, question_text: { type: "STRING" }, question_text_translation: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, correct_option: { type: "STRING" } }, required: ["id", "question_text", "question_text_translation", "options", "correct_option"] } } }, required: ["audio_script", "audio_script_translation", "questions"] } }),
    speakingPractice: (input) => ({ prompt: `Dựa vào chủ đề "${input}", hãy tạo một câu tiếng Việt đơn giản ngẫu nhiên là câu hỏi, phủ định, khẳng định hoặc câu ghép chia đều % xuất hiện các câu, phù hợp cho người học tiếng Anh trình độ A2-B1. Trả về một đối tượng JSON với khóa duy nhất "vietnamese_sentence".`, schema: { type: "OBJECT", properties: { vietnamese_sentence: { type: "STRING" } }, required: ["vietnamese_sentence"] } }),
    speakingPracticeSingle: (vietnameseSentence) => ({ prompt: `Hãy cung cấp 3 bản dịch tiếng Anh cho câu tiếng Việt sau: "${vietnameseSentence}". Mỗi bản dịch kèm theo mức độ phổ biến ("Rất phổ biến", "Phổ biến", "Ít phổ biến"). Trả về một đối tượng JSON với khóa "suggestions" (một mảng các đối tượng, mỗi đối tượng có khóa "translation" và "popularity").`, schema: { type: "OBJECT", properties: { suggestions: { type: "ARRAY", items: { type: "OBJECT", properties: { translation: { type: "STRING" }, popularity: { type: "STRING"}}, required: ["translation", "popularity"] } } }, required: ["suggestions"] } }),
    writingPractice: (input) => ({ prompt: `Dựa vào chủ đề "${input}", hãy tạo một câu tiếng Việt đơn giản, ngẫu nhiên, phù hợp cho người học tiếng Anh trình độ A2-B1. Trả về một đối tượng JSON với khóa duy nhất "vietnamese_sentence".`, schema: { type: "OBJECT", properties: { vietnamese_sentence: { type: "STRING" } }, required: ["vietnamese_sentence"] } }),
    checkTranslation: (vietnameseSentence, englishSentence) => ({ prompt: `Dựa trên câu gốc tiếng Việt: "${vietnameseSentence}", hãy kiểm tra và sửa lỗi câu dịch tiếng Anh sau: "${englishSentence}". Cung cấp câu gốc, phiên bản đã sửa, danh sách các thay đổi (giải thích ngắn gọn từng lỗi BẰNG TIẾNG VIỆT). Nếu câu dịch đã đúng, hãy xác nhận là đúng và dịch nghĩa. Trả về đối tượng JSON với các khóa: "is_correct" (boolean), "original_sentence", "corrected_sentence", "changes" (mảng chuỗi).`, schema: { type: "OBJECT", properties: { is_correct: {type: "BOOLEAN"}, original_sentence: { type: "STRING" }, corrected_sentence: { type: "STRING" }, changes: { type: "ARRAY", items: { type: "STRING" } } }, required: ["is_correct", "original_sentence", "corrected_sentence", "changes"] } }),
    comparison: (input) => ({ prompt: `So sánh các từ/cụm từ tiếng Anh sau: "${input}". Đối với mỗi từ, giải thích sắc thái ý nghĩa và cách dùng bằng tiếng Việt, kèm theo một câu ví dụ minh họa và bản dịch tiếng Việt của câu ví dụ đó. Trả về một mảng JSON, mỗi đối tượng có các khóa: "word", "explanation", "example_sentence", "example_translation".`, schema: { type: "ARRAY", items: { type: "OBJECT", properties: { word: { type: "STRING" }, explanation: { type: "STRING" }, example_sentence: { type: "STRING" }, example_translation: { type: "STRING" } }, required: ["word", "explanation", "example_sentence", "example_translation"] } } }),
    tone: (input) => ({ prompt: `Phân tích giọng điệu (ví dụ: Thân mật, Trang trọng, Giận dữ, Trung lập, Lịch sự) của câu tiếng Anh sau: "${input}". Cung cấp giải thích bằng tiếng Việt. Nếu có thể, đề xuất cách viết lại câu với 1-2 giọng điệu khác. Trả về đối tượng JSON với các khóa: "original_sentence", "tone", "explanation", "suggestions" (mảng các đối tượng, mỗi đối tượng có "new_tone" và "rewritten_sentence").`, schema: { type: "OBJECT", properties: { original_sentence: { type: "STRING" }, tone: { type: "STRING" }, explanation: { type: "STRING" }, suggestions: { type: "ARRAY", items: { type: "OBJECT", properties: { new_tone: { type: "STRING" }, rewritten_sentence: { type: "STRING" } } } } }, required: ["original_sentence", "tone", "explanation"] } }),
    idiom: (input) => ({ prompt: `Giải thích thành ngữ tiếng Anh '${input}'. Cung cấp bản dịch đen (nếu có, bằng tiếng Việt), ý nghĩa thực sự (bằng tiếng Việt), nguồn gốc hoặc câu chuyện đằng sau nó (bằng tiếng Việt), và 3 câu ví dụ (tiếng Anh kèm bản dịch tiếng Việt). Trả về JSON với các khóa: 'idiom', 'literal_translation', 'meaning', 'origin', 'examples' (mảng đối tượng có 'english' và 'vietnamese').`, schema: { type: "OBJECT", properties: { idiom: { type: "STRING" }, literal_translation: { type: "STRING" }, meaning: { type: "STRING" }, origin: { type: "STRING" }, examples: { type: "ARRAY", items: { type: "OBJECT", properties: { english: { type: "STRING" }, vietnamese: { type: "STRING" } }, required: ["english", "vietnamese"] } } }, required: ["idiom", "meaning", "origin", "examples"] } }),
    emailDrafter: (input) => ({ prompt: `Soạn 3 email cho mục đích: "${input}". Cung cấp phiên bản trang trọng (formal), bán trang trọng (semi-formal), và thân mật (informal). Trả về đối tượng JSON với các khóa 'purpose' và 'drafts' (mảng đối tượng, mỗi đối tượng có 'tone' và 'body').`, schema: { type: "OBJECT", properties: { purpose: { type: "STRING" }, drafts: { type: "ARRAY", items: { type: "OBJECT", properties: { tone: { type: "STRING" }, body: { type: "STRING" } }, required: ["tone", "body"] } } }, required: ["purpose", "drafts"] } }),
    translateVnToEn: (input) => ({ prompt: `Dịch câu tiếng Việt sau đây sang tiếng Anh: "${input}". Cung cấp 5-7 phương án dịch khác nhau, sắp xếp theo mức độ phổ biến từ cao đến thấp. Với mỗi phương án, hãy cung cấp: 1. Bản dịch tiếng Anh. 2. Trạng thái phổ biến BẰNG TIẾNG VIỆT (ví dụ: "Rất phổ biến", "Tự nhiên", "Hơi trang trọng", "Ít dùng"). 3. Một ghi chú ngắn về ngữ cảnh sử dụng BẰNG TIẾNG VIỆT. Trả về một mảng JSON các đối tượng có khóa: "english_translation", "popularity_status" (bằng tiếng Việt), "usage_note" (bằng tiếng Việt).`, schema: { type: "ARRAY", items: { type: "OBJECT", properties: { english_translation: { type: "STRING" }, popularity_status: { type: "STRING" }, usage_note: { type: "STRING" } }, required: ["english_translation", "popularity_status", "usage_note"] } } }),
    conversationCorrection: (originalSentence) => ({ prompt: `Phân tích câu tiếng Anh sau: "${originalSentence}". Nếu có lỗi ngữ pháp/cú pháp/chính tả, hãy sửa lại và giải thích chi tiết lỗi bằng tiếng Việt, cung cấp câu đã sửa, ghi chú chỉnh sửa, và dịch nghĩa. Nếu câu đúng, hãy xác nhận là đúng và dịch nghĩa. Trả về một đối tượng JSON với các khóa "originalSentence", "correctedSentence", "isCorrect", "correctionNotes", "alternativePhrases", và "vietnameseTranslation".`, schema: { type: "OBJECT", properties: { originalSentence: { type: "STRING" }, correctedSentence: { type: "STRING" }, isCorrect: { type: "BOOLEAN" }, correctionNotes: { type: "STRING" }, alternativePhrases: { type: "ARRAY", items: { type: "STRING" } }, vietnameseTranslation: { type: "STRING" } }, required: ["originalSentence", "correctedSentence", "isCorrect", "correctionNotes", "alternativePhrases", "vietnameseTranslation"] } }),
    getUnusedWords: (scenario) => ({ prompt: `Dựa trên kịch bản hội thoại "${scenario}", hãy gợi ý một danh sách khoảng 5-10 từ vựng tiếng Anh liên quan. Trả về một mảng JSON các chuỗi từ vựng.`, schema: { type: "ARRAY", items: { type: "STRING" } } }),
    conversationTurn: (conversationContext, latestMessage) => ({ prompt: `Tiếp tục cuộc hội thoại tiếng Anh này. Bạn là Alex. Bối cảnh: ${conversationContext}. Tin nhắn gần nhất: ${latestMessage}. Phản hồi ngắn gọn, tự nhiên. Trả về JSON có khóa "english" và "vietnamese".`, schema: { type: "OBJECT", properties: { english: { type: "STRING" }, vietnamese: { type: "STRING" } }, required: ["english", "vietnamese"] } }),
    translateText: (text) => ({ prompt: `Dịch sang tiếng Việt: "${text}". Trả về JSON có khóa "translation".`, schema: { type: "OBJECT", properties: { translation: { type: "STRING" } }, required: ["translation"] } })
};

// --- Function Triggers ---
function generateExamples() { handleFeature('example', 'Tạo ví dụ', prompts.examples, renderers.examples); }
function generateExercise() { handleFeature('exercise', 'Tạo Bài Tập Viết', prompts.exercise, renderers.exercise); }
function generateListeningFillInTheBlank() { handleFeature('listeningFillInTheBlank', 'Bài tập Nghe & Điền từ', prompts.listeningFillInTheBlank, renderers.listeningFillInTheBlank); }
function generateExplanation() { handleFeature('explanation', 'Giải thích Từ Vựng', prompts.explanation, renderers.explanation); }
function correctSentence() { handleFeature('correction', 'Sửa Câu', prompts.correction, renderers.correction); }
function generateDialogue() { handleFeature('dialogue', 'Tạo Đoạn Hội Thoại', prompts.dialogue, renderers.dialogue); }
function summarizeText() { handleFeature('summary', 'Tóm Tắt Văn Bản', prompts.summary, renderers.summary); }
function generateParagraphs() { handleFeature('paragraph', 'Viết Đoạn Văn', prompts.paragraphs, renderers.paragraphs, (input) => input.includes(',') || input.includes(' ')); }
function checkPopularity() { handleFeature('popularity', 'Kiểm Tra Mức Độ Phổ Biến', prompts.popularity, renderers.popularity); }
function translateSentence() { handleFeature('translation', 'Dịch câu Việt - Anh', prompts.translateVnToEn, renderers.translationResults); }
function generateReadingAndQuestions() { handleFeature('reading', 'Bài Đọc & Câu Hỏi', prompts.reading, renderers.reading); }
function generateListeningAndQuestions() { handleFeature('listening', 'Bài Nghe & Câu Hỏi', prompts.listening, renderers.listening); }
function startSpeakingPractice() { handleFeature('speakingPractice', 'Luyện phản xạ nói', null, renderers.speakingPractice); }

// Modified to show a modal for input
function startSpeakingPracticeManual() {
    const manualSpeakingModal = document.getElementById('manualSpeakingModal');
    manualSpeakingModal.style.display = 'flex'; // Show the modal

    // Event listener for the "Bắt đầu Luyện tập" button inside the modal
    document.getElementById('startManualPracticeBtn').onclick = () => {
        const sentencesText = document.getElementById('manualSentencesInput').value.trim();
        if (!sentencesText) {
            showMessage('Vui lòng nhập ít nhất một câu để luyện tập.', 'error');
            return;
        }
        const sentences = sentencesText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (sentences.length === 0) {
            showMessage('Vui lòng nhập ít nhất một câu để luyện tập.', 'error');
            return;
        }
        manualSpeakingModal.style.display = 'none'; // Hide the modal
        // Corrected call: Pass the 'sentences' array directly as the input to the renderer via handleFeature
        handleFeature('speakingPracticeManual', 'Luyện phản xạ thủ công', null,
            (input, content, headerText) => renderers.speakingPracticeManual(sentences, content, headerText), // Pass 'sentences' here
            (input) => input.length > 0 // Validator still checks array length
        );
    };

    // Event listeners to close the modal
    document.getElementById('closeManualSpeakingModal').onclick = () => {
        manualSpeakingModal.style.display = 'none';
    };
    manualSpeakingModal.onclick = (event) => {
        if (event.target == manualSpeakingModal) {
            manualSpeakingModal.style.display = 'none';
        }
    };
}

function startWritingPractice() { handleFeature('writingPractice', 'Luyện viết (AI)', null, renderers.writingPractice); }
function compareVocabulary() { handleFeature('comparison', 'So Sánh Từ Vựng', prompts.comparison, renderers.comparison, (input) => input.split(',').length > 1); }
function analyzeTone() { handleFeature('tone', 'Phân Tích Giọng Điệu', prompts.tone, renderers.tone); }
function explainIdiom() { handleFeature('idiom', 'Giải thích Thành ngữ', prompts.idiom, renderers.idiom); }
function startConversationSimulator() { handleFeature('conversationSimulator', 'Mô phỏng Hội thoại', null, renderers.conversationSimulator); }
function draftEmail() { handleFeature('emailDrafter', 'Soạn thảo Email', prompts.emailDrafter, renderers.emailDrafter); }

async function generateImage() {
    // ĐÃ XOÁ TOÀN BỘ HÀM TẠO ẢNH
}

// --- Interactive Answer Checking ---
function checkFillInBlankAnswer(button, correctWord) {
    const item = button.closest('.exercise-item');
    const feedback = item.querySelector('.exercise-feedback');
    const options = item.querySelectorAll('.option-btn');

    options.forEach(btn => btn.disabled = true);

    if (button.dataset.value === correctWord) {
        button.classList.add('correct');
        feedback.innerHTML = 'Chính xác! 🎉';
        feedback.style.color = '#059669';
        feedback.style.backgroundColor = '#d1fae5';
    } else {
        button.classList.add('incorrect');
        feedback.innerHTML = `Sai rồi. Đáp án đúng là "<b>${correctWord}</b>"`;
        feedback.style.color = '#dc2626';
        feedback.style.backgroundColor = '#fee2e2';
        const correctButton = item.querySelector(`button[data-value="${correctWord.replace(/"/g, '&quot;')}"]`);
        if(correctButton) correctButton.classList.add('correct');
    }
}

function checkMultipleChoiceAnswer(button) {
    const item = button.closest('.question-item');
    const optionsContainer = button.parentElement;
    const feedbackEl = item.querySelector('.question-feedback');
    const correctAnswer = item.dataset.correctAnswer;
    const questionTranslation = item.dataset.questionTranslation;

    optionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.disabled = true);

    const isCorrect = button.textContent === correctAnswer;

    if (isCorrect) {
        button.classList.add('correct');
        feedbackEl.innerHTML = `Chính xác! 🎉 <br><span class="question-translation">(Dịch: ${questionTranslation})</span>`;
    } else {
        button.classList.add('incorrect');
        const correctBtn = Array.from(optionsContainer.querySelectorAll('button')).find(b => b.textContent === correctAnswer);
        if (correctBtn) {
            correctBtn.classList.add('correct');
        }
        feedbackEl.innerHTML = `Sai rồi. Đáp án đúng là: "<b>${correctAnswer}</b>" <br><span class="question-translation">(Dịch: ${questionTranslation})</span>`;
    }
}


// --- Audio Player & Speech Recognition Logic ---
function speakText(text) {
    if (!('speechSynthesis' in window)) {
        showMessage('Trình duyệt không hỗ trợ phát âm thanh.', 'error');
        return;
    }
    if (speechSynthesis.speaking && !isSpeakingFullDialogue) {
        speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices().filter(voice => voice.lang.startsWith('en'));
    if (voices.length > 0) {
        const preferredVoice = voices.find(v => v.name === 'Google US English' || v.name.includes('English (United States)'));
        utterance.voice = preferredVoice || voices[0];
        utterance.rate = 0.9;
    }

    utterance.onerror = (event) => console.error("Lỗi phát âm thanh:", event);

    speechSynthesis.speak(utterance);
}

function playQuestionAudio(button, text) {
    if (!('speechSynthesis' in window)) {
        showMessage('Trình duyệt của bạn không hỗ trợ phát âm thanh.', 'error');
        return;
    }
    if (speechSynthesis.speaking) speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices().filter(voice => voice.lang.startsWith('en'));
    if (voices.length > 0) {
        const preferredVoice = voices.find(v => v.name === 'Google US English' || v.name.includes('English (United States)'));
        utterance.voice = preferredVoice || voices[0];
    }

    const originalIconSVG = button.innerHTML;
    button.innerHTML = `<div class="spinning-loader"></div>`;
    button.disabled = true;

    utterance.onend = () => { button.innerHTML = originalIconSVG; button.disabled = false; };
    utterance.onerror = (event) => { button.innerHTML = originalIconSVG; button.disabled = false; console.error("Lỗi phát âm thanh:", event); };

    speechSynthesis.speak(utterance);
}

function setupAudioPlayer(script, container) {
    container.innerHTML = `
        <div class="audio-player">
            <div class="audio-controls">
                <button id="audioPlayBtn" class="audio-btn" title="Phát"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M10.804 8 5 4.633v6.734L10.804 8zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm15 0a7 7 0 1 0-14 0 7 7 0 0 0 14 0z"/></svg></button>
                <button id="audioPauseBtn" class="audio-btn" title="Tạm dừng" style="display: none;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M6 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5zm4 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm15 0a7 7 0 1 0-14 0 7 7 0 0 0 14 0z"/></svg></button>
                <button id="audioStopBtn" class="audio-btn" title="Dừng"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v4a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 0 1H6.5a.5.5 0 0 1 0-1H10.5zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm15 0a7 7 0 1 0-14 0 7 7 0 0 0 14 0z"/></svg></button>
            </div>
            <div id="audioStatus" class="audio-status">Sẵn sàng</div>
        </div>
    `;

    const playBtn = document.getElementById('audioPlayBtn'), pauseBtn = document.getElementById('audioPauseBtn'), stopBtn = document.getElementById('audioStopBtn'), statusDiv = document.getElementById('audioStatus');
    if (!('speechSynthesis' in window)) { statusDiv.textContent = 'Trình duyệt không hỗ trợ'; playBtn.disabled = true; return; }

    let utterance = new SpeechSynthesisUtterance(script);
    let voices = [];
    const populateVoiceList = () => { voices = speechSynthesis.getVoices().filter(voice => voice.lang.startsWith('en')); if (voices.length > 0) utterance.voice = voices.find(v => v.name === 'Google US English' || v.name.includes('English (United States)')) || voices[0]; };
    populateVoiceList();
    if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = populateVoiceList;

    utterance.onstart = () => { statusDiv.textContent = 'Đang phát...'; playBtn.style.display = 'none'; pauseBtn.style.display = 'flex'; };
    utterance.onpause = () => { statusDiv.textContent = 'Đã tạm dừng'; playBtn.style.display = 'flex'; pauseBtn.style.display = 'none'; };
    utterance.onresume = () => { statusDiv.textContent = 'Đang phát...'; playBtn.style.display = 'none'; pauseBtn.style.display = 'flex'; };
    utterance.onend = () => { statusDiv.textContent = 'Đã kết thúc'; playBtn.style.display = 'flex'; pauseBtn.style.display = 'none'; };
    utterance.onerror = (e) => { console.error(e); statusDiv.textContent = 'Lỗi phát âm'; playBtn.style.display = 'flex'; pauseBtn.style.display = 'none'; };

    playBtn.addEventListener('click', () => { if (speechSynthesis.paused) { speechSynthesis.resume(); } else { speechSynthesis.cancel(); setTimeout(() => speechSynthesis.speak(utterance), 100); } });
    pauseBtn.addEventListener('click', () => { if (speechSynthesis.speaking) speechSynthesis.pause(); });
    stopBtn.addEventListener('click', () => { if (speechSynthesis.speaking || speechSynthesis.paused) speechSynthesis.cancel(); });
}

async function handlePronunciationRecording(vietnameseSentence, suggestions) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showMessage('Trình duyệt của bạn không hỗ trợ nhận dạng giọng nói.', 'error');
        return;
    }

    let targetSuggestions = suggestions;
    const recordBtn = document.getElementById('record-pronunciation-btn');
    const scoreContainer = document.getElementById('pronunciation-score-container');

    // If a recording is already in progress, stop it and reset state
    if (isRecording) {
        if (recognition) recognition.stop();
        return; // Exit function, as the stop event will handle cleanup
    }

    // If no suggestions are available, fetch them
    if (targetSuggestions.length === 0) {
         scoreContainer.innerHTML = '<p class="text-center font-semibold">Đang lấy câu gợi ý...</p>';
         scoreContainer.classList.remove('hidden');
         try {
            const { prompt, schema } = prompts.speakingPracticeSingle(vietnameseSentence);
            const suggestionData = await callGemini(prompt, schema);
            targetSuggestions = suggestionData.suggestions;

            if (!targetSuggestions || targetSuggestions.length === 0) {
                throw new Error("AI không trả về gợi ý.");
            }
            scoreContainer.classList.add('hidden'); // Hide "Đang lấy câu gợi ý..."
            scoreContainer.innerHTML = ''; // Clear content
         } catch (error) {
            console.error('Lỗi khi lấy gợi ý tự động:', error);
            showMessage('Không thể lấy câu gợi ý để chấm điểm. Vui lòng thử lại.', 'error');
            scoreContainer.classList.add('hidden');
            scoreContainer.innerHTML = '';
            return;
         }
    }

    const targetSentence = targetSuggestions[0].translation; // Use the first suggestion as the target

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const recordBtnSpan = recordBtn.querySelector('span');
    const originalBtnText = recordBtnSpan.textContent;

    recognition.onstart = () => {
        isRecording = true;
        recordBtn.classList.add('recording');
        recordBtnSpan.textContent = 'Đang ghi âm... (Nhấn để dừng)';
        // recordBtn.disabled = true; // No longer disable, allow stopping
        scoreContainer.classList.add('hidden');
    };

    recognition.onresult = async (event) => {
        const spokenText = event.results[0][0].transcript;
        scoreContainer.innerHTML = '<p class="text-center font-semibold">Đang chấm điểm...</p>';
        scoreContainer.classList.remove('hidden');

        try {
            const {prompt, schema} = prompts.pronunciationScore(targetSentence, spokenText);
            const result = await callGemini(prompt, schema);

            // Highlight differences
            const highlightedSpokenText = highlightDifferences(targetSentence, spokenText);

            scoreContainer.innerHTML = `
                <div class="pronunciation-score-card">
                    <div class="score-circle">${result.score}%</div>
                    <h4 class="card-title-alt">Kết quả của bạn</h4>
                    <p class="text-lg italic">"${highlightedSpokenText}"</p>
                    <h4 class="card-title-alt mt-4">Câu trả lời gợi ý</h4>
                    <p class="text-lg font-medium text-green-600">"${targetSentence}"</p>
                    <h4 class="card-title-alt mt-4">Nhận xét của AI</h4>
                    <p>${result.feedback}</p>
                </div>
            `;

        } catch (error) {
            console.error('Lỗi chấm điểm phát âm:', error);
            scoreContainer.innerHTML = `<p class="text-red-500">Lỗi: ${error.message}</p>`;
        }
    };

    recognition.onerror = (event) => {
        console.error('Lỗi nhận dạng giọng nói:', event.error);
        showMessage(`Lỗi ghi âm: ${event.error}`, 'error');
    };

    recognition.onend = () => {
        isRecording = false;
        recordBtn.classList.remove('recording');
        recordBtnSpan.textContent = originalBtnText;
        // recordBtn.disabled = false; // Re-enable if it was disabled
    };

    recognition.start();
}

function playFullDialogue(lines) {
    if (!('speechSynthesis' in window)) {
        showMessage('Trình duyệt không hỗ trợ phát âm thanh.', 'error');
        return;
    }
    if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
    }

    isSpeakingFullDialogue = true;
    currentUtteranceQueue = [...lines];
    // Also stop recording if active
    if (isRecording) {
        if (recognition) recognition.stop();
    }


    const speakNextLine = () => {
        if (currentUtteranceQueue.length > 0 && isSpeakingFullDialogue) {
            const line = currentUtteranceQueue.shift();
            const utterance = new SpeechSynthesisUtterance(line);
            const voices = speechSynthesis.getVoices().filter(voice => voice.lang.startsWith('en'));
            if (voices.length > 0) {
                const preferredVoice = voices.find(v => v.name === 'Google US English' || v.name.includes('English (United States)'));
                utterance.voice = preferredVoice || voices[0];
                utterance.rate = 0.9;
            }

            utterance.onend = () => {
                speakNextLine();
            };
            utterance.onerror = (event) => {
                console.error("Lỗi phát âm dòng hội thoại:", event);
                speakNextLine();
            };
            speechSynthesis.speak(utterance);
        } else {
            isSpeakingFullDialogue = false;
        }
    };
    speakNextLine();
}

// --- Conversation Simulator Logic ---
async function initializeUnusedWords(scenario) {
    try {
        const { prompt, schema } = prompts.getUnusedWords(scenario);
        const words = await callGemini(prompt, schema);
        unusedWords = words.map(word => word.toLowerCase());
        updateUnusedWordsDisplay();
    } catch (error) {
        console.error("Error initializing unused words:", error);
        unusedWords = ["excellent", "challenge", "opportunity", "fluent", "practice"];
        updateUnusedWordsDisplay();
    }
}

function updateUnusedWordsDisplay() {
    const unusedWordsListEl = document.getElementById('unusedWordsList');
    if (unusedWordsListEl) {
        if (unusedWords.length > 0) {
            unusedWordsListEl.textContent = unusedWords.join(', ');
        } else {
            unusedWordsListEl.textContent = 'Tuyệt vời! Bạn đã sử dụng hết các từ gợi ý.';
        }
    }
}

async function getNextAiResponse() {
    const chatInput = document.getElementById('chatInput');
    const chatSendButton = document.getElementById('chatSendButton');
    try {
        const context = conversationHistory.map(turn => `${turn.role}: ${turn.parts[0].text}`).join('\n');
        const lastUserMessage = conversationHistory.length > 1 ? conversationHistory[conversationHistory.length - 1].parts[0].text : "(bắt đầu cuộc hội thoại)";
        const { prompt, schema } = prompts.conversationTurn(context, lastUserMessage);
        const aiResponse = await callGemini(prompt, schema);

        const modelResponse = { role: 'model', parts: [{ text: aiResponse.english }] };
        conversationHistory.push(modelResponse);
        addMessageToUI(aiResponse.english, aiResponse.vietnamese, 'ai');
    } catch (error) {
        console.error("Lỗi hội thoại:", error);
        addMessageToUI('Xin lỗi, tôi gặp sự cố.', 'Sorry, I encountered an issue.', 'ai');
    } finally {
        if (chatInput) chatInput.disabled = false;
        if (chatSendButton) chatSendButton.disabled = false;
    }
}

function addMessageToUI(englishText, vietnameseTranslation, sender) {
    const messageArea = document.getElementById('messageArea');
    if (!messageArea) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    messageDiv.innerHTML = `
        <span>${englishText}</span>
        <p class="translation">(Dịch: ${vietnameseTranslation})</p>
    `;
    messageArea.appendChild(messageDiv);
    messageArea.scrollTop = messageArea.scrollHeight;
}

async function continueConversation(scenario) {
    const chatInput = document.getElementById('chatInput');
    const chatSendButton = document.getElementById('chatSendButton');
    if (!chatInput) return;

    const userMessageEnglish = chatInput.value.trim();
    if (!userMessageEnglish) return;

    chatInput.disabled = true;
    if(chatSendButton) chatSendButton.disabled = true;

    let userMessageVietnamese = '';
    try {
        const { prompt, schema } = prompts.translateText(userMessageEnglish);
        const translationResult = await callGemini(prompt, schema);
        userMessageVietnamese = translationResult.translation;
    } catch (error) {
        console.error("Lỗi dịch:", error);
        userMessageVietnamese = "Không thể dịch.";
    }

    const userTurn = { role: 'user', parts: [{ text: userMessageEnglish }] };
    conversationHistory.push(userTurn);
    addMessageToUI(userMessageEnglish, userMessageVietnamese, 'user');
    chatInput.value = '';

    const userWords = userMessageEnglish.toLowerCase().split(/\s+|[.,!?;:]+/).filter(Boolean);
    unusedWords = unusedWords.filter(word => !userWords.includes(word));
    updateUnusedWordsDisplay();

    try {
        const { prompt, schema } = prompts.conversationCorrection(userMessageEnglish);
        const correctionResult = await callGemini(prompt, schema);
        if (!correctionResult.isCorrect) {
            showCorrectionModal(correctionResult);
        }
    } catch (error) {
        console.error("Lỗi kiểm tra ngữ pháp:", error);
    }

    await getNextAiResponse();
}

function showCorrectionModal(data) {
    modalCorrectionContent.innerHTML = `
        <div class="table-container">
        <table class="correction-table w-full">
            <tr> <th class="w-1/3">Mục</th> <th>Nội dung</th> </tr>
            <tr> <td>📥 Câu gốc</td> <td>${data.originalSentence}</td> </tr>
            <tr> <td>✅ Câu đã sửa</td> <td>${data.correctedSentence}</td> </tr>
            <tr> <td>🛠️ Ghi chú</td> <td>${data.correctionNotes}</td> </tr>
            <tr> <td>💬 Cách nói khác</td> <td>${data.alternativePhrases.join(' / ')}</td> </tr>
            <tr> <td>🇳 Dịch nghĩa</td> <td>${data.vietnameseTranslation}</td> </tr>
        </table>
        </div>
    `;
    correctionModal.style.display = 'flex';
}

// --- Quick Search & Spell Check ---
function searchWithCorrection(correctedWord) {
    vocabularyInput.value = correctedWord;
    quickSearch();
}

async function quickSearch(options = {}) {
    const { bypassSpellCheck = false, wordToSearch = null } = options;
    const input = wordToSearch || vocabularyInput.value.trim();
    if (!input) {
        showMessage('Vui lòng nhập từ hoặc cụm từ để tra cứu.', 'error');
        return;
    }

    hideAllSections();

    quickSearchResults.innerHTML = `<div class="info-card p-4 flex items-center justify-center"> <div class="loading-spinner" style="width: 24px; height: 24px; border-width: 3px;"></div> <span class="ml-3 text-gray-600 dark:text-gray-300">Đang tra cứu...</span> </div>`;

    if (!bypassSpellCheck && !input.includes(' ')) {
        try {
            const { prompt, schema } = prompts.spellCheck(input);
            const spellResult = await callGemini(prompt, schema);

            if (!spellResult.is_correct && spellResult.corrected_word.toLowerCase() !== input.toLowerCase()) {
                renderers.spellCheckSuggestion(input, spellResult.corrected_word, quickSearchResults);
                return;
            }
        } catch (error) {
            console.error("Spell check failed:", error);
        }
    }

    speakText(input);

    try {
        const { prompt, schema } = prompts.quickLookup(input);
        const data = await callGemini(prompt, schema);
        renderers.quickLookup(data, quickSearchResults);
    } catch (error) {
        showMessage('Không thể tra cứu. Vui lòng thử lại.', 'error');
        console.error('Lỗi tra cứu nhanh:', error);
        quickSearchResults.innerHTML = `<div class="info-card p-4 text-center text-red-600 dark:text-red-400">Không tìm thấy kết quả cho "${input}".</div>`;
    }
}

// --- Event Listeners ---
function attachEventListeners() {
    document.getElementById('btnClearInput').addEventListener('click', clearInput);
    document.getElementById('btnPasteClipboard').addEventListener('click', pasteFromClipboard);
    document.getElementById('btnQuickSearch').addEventListener('click', () => quickSearch());

    document.getElementById('btnGenerateExercise').addEventListener('click', generateExercise);
    document.getElementById('btnGenerateListeningFillInTheBlank').addEventListener('click', generateListeningFillInTheBlank);
    document.getElementById('btnGenerateExplanation').addEventListener('click', generateExplanation);
    document.getElementById('btnCorrectSentence').addEventListener('click', correctSentence);
    document.getElementById('btnGenerateReadingAndQuestions').addEventListener('click', generateReadingAndQuestions);
    document.getElementById('btnGenerateListeningAndQuestions').addEventListener('click', generateListeningAndQuestions);
    document.getElementById('btnGenerateExamples').addEventListener('click', generateExamples);
    document.getElementById('btnGenerateDialogue').addEventListener('click', generateDialogue);
    document.getElementById('btnGenerateParagraphs').addEventListener('click', generateParagraphs);
    document.getElementById('btnSummarizeText').addEventListener('click', summarizeText);
    document.getElementById('btnStartWritingPractice').addEventListener('click', startWritingPractice);
    document.getElementById('btnCompareVocabulary').addEventListener('click', compareVocabulary);
    document.getElementById('btnAnalyzeTone').addEventListener('click', analyzeTone);
    document.getElementById('btnExplainIdiom').addEventListener('click', explainIdiom);
    document.getElementById('btnCheckPopularity').addEventListener('click', checkPopularity);
    document.getElementById('btnTranslateSentence').addEventListener('click', translateSentence);
    document.getElementById('btnStartConversationSimulator').addEventListener('click', startConversationSimulator);
    document.getElementById('btnDraftEmail').addEventListener('click', draftEmail);
    //document.getElementById('btnGenerateImage').addEventListener('click', generateImage);
    document.getElementById('btnStartSpeakingPractice').addEventListener('click', startSpeakingPractice);
    document.getElementById('btnStartSpeakingPracticeManual').addEventListener('click', startSpeakingPracticeManual);

    document.getElementById('btnGoogleTranslate').addEventListener('click', () => openLink('googleTranslate'));
    document.getElementById('btnOxfordDictionary').addEventListener('click', () => openLink('oxfordDictionary'));
    document.getElementById('btnYouglish').addEventListener('click', () => openLink('youglish'));
    document.getElementById('btnGoogleImages').addEventListener('click', () => openLink('googleImages'));

    closeCorrectionModalBtn.addEventListener('click', () => { correctionModal.style.display = 'none'; });
    window.addEventListener('click', (event) => { if (event.target == correctionModal) { correctionModal.style.display = 'none'; } });
}

// --- API Key & Login Code Modal Logic ---
const API_KEY_STORAGE = 'user_api_key';
const LICENSE_KEY_STORAGE = 'user_license_key';

function showStartupModal(errorMsg = '') {
  const modal = document.getElementById('startupModal');
  const errorDiv = document.getElementById('startupModalError');
  modal.style.display = 'flex';
  if (errorMsg) {
    errorDiv.textContent = errorMsg;
    errorDiv.style.display = 'block';
  } else {
    errorDiv.style.display = 'none';
  }
}
function hideStartupModal() {
  document.getElementById('startupModal').style.display = 'none';
}
function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE);
}
function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key);
}
function getLicenseKey() {
  return localStorage.getItem(LICENSE_KEY_STORAGE);
}
function setLicenseKey(key) {
  localStorage.setItem(LICENSE_KEY_STORAGE, key);
}
function clearKeysAndLogout() {
  localStorage.removeItem(API_KEY_STORAGE);
  localStorage.removeItem(LICENSE_KEY_STORAGE);
  showStartupModal();
  document.body.style.overflow = 'hidden';
}
// Thêm nút đăng xuất nếu muốn
window.addEventListener('DOMContentLoaded', async () => {
  // Kiểm tra API key và license key trước khi cho sử dụng app
  let userApiKey = getApiKey();
  let licenseKey = getLicenseKey();
  if (!userApiKey || !licenseKey) {
    showStartupModal('Bạn cần nhập API key và mã kích hoạt để sử dụng!');
    document.body.style.overflow = 'hidden';
    return;
  }
  // Kiểm tra lại license mỗi lần load (phòng bị thu hồi)
  const result = await checkLicenseKey(licenseKey);
  if (!result.valid) {
    showStartupModal('Mã kích hoạt không hợp lệ hoặc đã bị thu hồi!');
    document.body.style.overflow = 'hidden';
    return;
  }
  document.body.style.overflow = '';
  applyTheme();
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
      tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tabContents.forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById(tab.dataset.tab).classList.add('active');
      });
  });
  attachEventListeners();
  // Thêm nút đăng xuất nếu muốn
  if (!document.getElementById('logoutBtn')) {
    const btn = document.createElement('button');
    btn.id = 'logoutBtn';
    btn.textContent = 'Đăng xuất';
    btn.className = 'external-btn';
    btn.style.position = 'fixed';
    btn.style.bottom = '20px';
    btn.style.right = '20px';
    btn.onclick = clearKeysAndLogout;
    document.body.appendChild(btn);
  }
});
document.getElementById('startupModalSubmit').onclick = async function() {
  const apiKey = document.getElementById('userApiKey').value.trim();
  const licenseKey = document.getElementById('userLoginCode').value.trim();
  if (!apiKey) {
    showStartupModal('Vui lòng nhập API key!');
    return;
  }
  if (!licenseKey) {
    showStartupModal('Vui lòng nhập mã kích hoạt!');
    return;
  }
  setApiKey(apiKey);
  setLicenseKey(licenseKey);
  document.getElementById('startupModalSubmit').disabled = true;
  document.getElementById('startupModalSubmit').innerText = 'Đang kiểm tra...';
  const result = await checkLicenseKey(licenseKey);
  document.getElementById('startupModalSubmit').disabled = false;
  document.getElementById('startupModalSubmit').innerText = 'Lưu & Bắt đầu';

  if (result.valid) {
    hideStartupModal();
    document.body.style.overflow = '';
    // Không reload trang ở đây nữa, chỉ reload nếu thực sự cần reset toàn bộ app
  } else {
    let msg = 'Mã kích hoạt không hợp lệ!';
    if (result.reason === 'inactive') msg = 'Mã này đã bị vô hiệu hóa!';
    if (result.reason === 'not_found') msg = 'Không tìm thấy mã này!';
    if (result.reason === 'network_error') msg = 'Lỗi kết nối, thử lại!';
    showStartupModal(msg);
  }
};
document.getElementById('startupModal').onclick = function(e) {
  if (e.target === this) {
    // Không cho đóng modal bằng click ngoài
  }
};

// Thay đổi URL này thành URL Apps Script của bạn
const LICENSE_API_URL = 'https://script.google.com/macros/s/AKfycbyJC0R6ebUA2bhpTEkCIqIZGMXmuobfb8BurS_RZ8eJXY_dCgYAs5wfI1vhPxy8Q9ap4A/exec';

async function checkLicenseKey(key) {
  try {
    const ua = navigator.userAgent;
    const res = await fetch(LICENSE_API_URL + '?key=' + encodeURIComponent(key) + '&ua=' + encodeURIComponent(ua));
    const data = await res.json();
    return data;
  } catch (e) {
    return {valid: false, reason: "network_error"};
  }
}