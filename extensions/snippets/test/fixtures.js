// Sample data used only by tests and screenshots. The extension itself starts empty.
import * as C from "../src/lib/core.js";

export function sample() {
  const g = (id, name, color) => ({ id, name, color });
  const s = (groupId, name, command, action = "run") => ({
    id: C.uid("s"),
    groupId,
    name,
    command,
    action,
    description: "",
    lastVars: {},
    updatedAt: 0,
  });
  return {
    version: C.SCHEMA_VERSION,
    groups: [
      g("g_docker", "Docker", "#7aa2f7"),
      g("g_k8s", "Kubernetes", "#73daca"),
      g("g_git", "Git", "#ff9e64"),
      g("g_srv", "Servers", "#9ece6a"),
      g("g_db", "Databases", "#bb9af7"),
    ],
    snippets: [
      s("g_docker", "Follow service logs", "docker compose logs -f --tail {{lines:100}} {{service}}"),
      s("g_docker", "Rebuild and start", "docker compose up -d --build"),
      s("g_docker", "Prune unused data", "docker system prune -af", "insert"),
      s("g_k8s", "Pods in namespace", "kubectl -n {{namespace}} get pods -o wide"),
      s("g_k8s", "Restart deployment", "kubectl -n {{namespace}} rollout restart deployment/{{deployment}}"),
      s("g_k8s", "Port-forward service", "kubectl -n {{namespace}} port-forward svc/{{service}} {{port:8080}}:80", "tab"),
      s("g_git", "Undo last commit", "git reset --soft HEAD~1", "insert"),
      s("g_git", "Clean merged branches", "git remote prune origin\ngit branch --merged main | grep -v main | xargs git branch -d"),
      s("g_srv", "SSH to host", "ssh {{user:ubuntu}}@{{host}}"),
      s("g_srv", "Disk usage", "df -h && du -sh * | sort -h"),
      s("g_db", "Postgres shell", "psql -h {{host:localhost}} -U {{user:postgres}} {{database}}"),
      s("g_db", "Redis CLI", "redis-cli -h {{host:localhost}} -p {{port:6379}}"),
    ],
  };
}
