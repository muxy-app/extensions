muxy.events.subscribe('file.changed', (payload) => {
  console.log('[files-demo] file.changed', payload.path, 'in', payload.projectPath);
});
