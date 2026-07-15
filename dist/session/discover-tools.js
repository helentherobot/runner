export function discoverTools(messages, tools) {
    const conversationText = messages
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join(' ');
    return tools.filter((tool) => {
        if (!tool.keywords) {
            return true;
        }
        const keywords = tool.keywords();
        if (keywords.length === 0) {
            return true;
        }
        return keywords.some((kw) => conversationText.includes(kw));
    });
}
