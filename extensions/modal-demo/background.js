muxy.events.subscribe("command.pick", async () => {
  const selected = await muxy.modal.open({
    placeholder: "Pick a fruit...",
    items: [
      { id: "apple", title: "Apple", subtitle: "Crisp and red" },
      { id: "banana", title: "Banana", subtitle: "Soft and yellow" },
      { id: "cherry", title: "Cherry", subtitle: "Small and tart" },
      { id: "date", title: "Date", subtitle: "Sweet and chewy" },
      { id: "elderberry", title: "Elderberry", subtitle: "Dark and tangy" },
    ],
  });

  if (!selected) {
    muxy.notifications.notify({ title: "Modal Demo", body: "Dismissed without a pick" });
    return;
  }

  muxy.notifications.notify({ title: "Modal Demo", body: `You picked ${selected.title}` });
});
