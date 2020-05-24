const MAX_MESSAGES = 20;
const messages = [];
const log = (message) => {
  console.log(message);
  messages.push({ time: Date.now(), message });
  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
};

module.exports = {
  log,
  messages: () => {
    return messages;
  },
  clearMessages: () => {
    messages.splice(0);
  },
};
