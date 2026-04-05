// Stub LLM provider for integration testing. Returns deterministic canned responses.
const completion = async (messages, _tools) => {
  const last = messages.filter((m) => m.role === 'user').pop();
  const raw = typeof last?.content === 'string' ? last.content : '';
  // Strip the <user_input> security wrapper the CLI adds
  const text = raw.replace(/<\/?user_input>/g, '').trim();

  return {
    choices: [
      {
        message: { role: 'assistant', content: `STUB_RESPONSE: ${text}` },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
};

module.exports = { completion };
