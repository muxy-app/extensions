muxy.events.subscribe('command.ping', async () => {
  const choice = await muxy.dialog.confirm({
    title: 'Background confirm',
    message: 'This dialog was triggered from the background script. Pick one.',
    buttons: ['Run it', 'Maybe later', 'Cancel'],
    default: 'Run it',
    cancel: 'Cancel',
    style: 'warning',
  });

  if (choice === null) {
    console.log('background confirm: cancelled');
    return;
  }

  await muxy.dialog.alert({
    title: 'You chose',
    message: `Background script received: "${choice}"`,
  });
});
