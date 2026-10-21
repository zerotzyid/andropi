---
name: linux-container
description: Install and run Linux software (Python, Node.js, compilers, databases, CLIs) on this Android phone through AndroPI's Linux container (Debian, Ubuntu, Alpine, Kali, openSUSE, Fedora or RHEL-family). Use whenever a task needs a package, runtime or tool that is not already on PATH, or when a command fails with "not found".
---

# Linux container

AndroPI can run a real Linux userland through proot. The app offers images for
32-bit armv7 phones as well as 64-bit arm64 phones: Debian, Ubuntu, Alpine,
Kali, openSUSE Tumbleweed and, on 64-bit devices, Fedora, AlmaLinux, Rocky
Linux, Amazon Linux, openSUSE Leap and Oracle Linux. The home folder and
workspace are mounted at the same paths inside, so files you create in either
place are the same files.

## Check what you have

```sh
cat /etc/os-release | head -1          # which distribution is active
command -v apt-get && echo apt-shell   # Debian, Ubuntu or Kali
command -v apk && echo alpine-shell    # Alpine
command -v dnf && echo rhel-shell      # Fedora, Alma, Rocky, Amazon or Oracle
command -v zypper && echo suse-shell   # openSUSE
command -v box && box -c 'uname -m'    # container exists, you are outside
```

- If a package manager works directly, every command already runs inside the
  container. Install with `apt-get install -y <pkg>`, `apk add <pkg>`,
  `dnf install -y <pkg>` or `zypper install -y <pkg>`.
- If only `box` works, run Linux commands as `box -c '<command>'`.
- If `box` prints "not installed", tell the user to install it in
  AndroPI under Settings → Linux container. Do not try to install it yourself.

## Installing things

Debian / Ubuntu / Kali:

```sh
apt-get update                    # once per session before the first install
apt-get install -y python3 python3-pip python3-venv nodejs npm build-essential
```

Alpine: `apk add python3 py3-pip nodejs npm build-base`.

Fedora / Alma / Rocky / Amazon / Oracle: `dnf install -y python3 nodejs npm gcc gcc-c++ make`.
openSUSE: `zypper install -y python3 nodejs npm gcc gcc-c++ make`.

The installer's **Full developer tools** option already adds Python, Node.js,
compilers, git, curl, wget, ripgrep, tmux and common CLIs to a new container.

- Python: Debian marks the system Python as externally managed. Use a venv
  (`python3 -m venv .venv && . .venv/bin/activate && pip install ...`) or
  `pip install --break-system-packages` for quick one-offs.
- Newer Node.js than the distro ships: `npm install -g n && n lts`, or use the
  NodeSource setup script found with web_search.
- When unsure of a package name or install method, use `web_search` first.

## Limits

- You are root inside, but it is emulated (proot): no kernel modules, no
  systemd/services, no Docker, no mounting. Run servers in the foreground or
  with `nohup ... &`.
- Check the CPU with `uname -m` (aarch64, armv7l or x86_64) and pick matching downloads.
- Processes are slower than native; avoid unbounded builds.
