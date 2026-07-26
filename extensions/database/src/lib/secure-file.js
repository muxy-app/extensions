import { run, tryRun } from "./exec.js";

const WRITER = 'open(my $f, ">", $ARGV[0]) or die "$!"; chmod 0600, $ARGV[0]; print $f $ARGV[1]; close $f;';
const APPENDER = 'open(my $f, ">>", $ARGV[0]) or die "$!"; print $f $ARGV[1]; close $f;';
const CHUNK = 96 * 1024;

export async function writeSecureFile(path, content) {
    await run(["perl", "-e", WRITER, path, content]);
}

export async function writeTextFile(path, content) {
    await run(["perl", "-e", WRITER, path, content.slice(0, CHUNK)]);
    for (let i = CHUNK; i < content.length; i += CHUNK)
        await run(["perl", "-e", APPENDER, path, content.slice(i, i + CHUNK)]);
}

export async function removeFile(path) {
    await tryRun(["rm", "-f", path]);
}
