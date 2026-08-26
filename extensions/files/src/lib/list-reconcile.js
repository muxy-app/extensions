export function reconcile_children(parent, nodes) {
  const wanted = new Set(nodes);
  let node = parent.firstChild;
  for (const next of nodes) {
    // Drop nodes that are gone rather than moving `next` past them — a move
    // detaches the node, and a detached row under the pointer swallows the
    // click that is mid-flight over it.
    while (node && !wanted.has(node)) {
      const after = node.nextSibling;
      parent.removeChild(node);
      node = after;
    }
    if (node === next) {
      node = node.nextSibling;
      continue;
    }
    parent.insertBefore(next, node);
  }
  while (node) {
    const after = node.nextSibling;
    parent.removeChild(node);
    node = after;
  }
}
