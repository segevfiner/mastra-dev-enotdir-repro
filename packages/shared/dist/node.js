'use strict';

const { EditorState } = require('@tiptap/pm/state');

function getMessage() {
  return `Hello from @mwe/shared (EditorState is ${typeof EditorState})`;
}

exports.getMessage = getMessage;
