/**
 * A Linux userland for the agent: an official Debian, Ubuntu, Alpine, Kali,
 * openSUSE, Fedora or RHEL-family image pulled from Docker Hub, unpacked into
 * app storage and entered through proot (tool/box.sh, on PATH as `box`). With
 * it enabled, pi's bash tool runs inside, so `apt install nodejs python3` just
 * works. Images are selected for the ABI the APK was installed for, including
 * linux/arm/v7 on 32-bit phones.
 */

import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { NAMESERVERS, type DnsMode } from "./dns.js";
import { type Log, run } from "./integrations.js";

export type Distro = string;

type Cpu = "armv7" | "arm64" | "amd64" | "x86";
type Family = "apt" | "apk" | "dnf" | "zypper";

interface Platform {
	abi: string;
	cpu: Cpu;
	bits: 32 | 64;
	label: string;
	/** Docker platform matchers, most specific first (armv7 falls back to armv6). */
	candidates: { architecture: string; variant?: string }[];
}

/** The Docker platform matching this phone's CPU (node reports the ABI the APK was installed for). */
const PLATFORM: Platform =
	process.arch === "arm"
		? {
				abi: "armeabi-v7a",
				cpu: "armv7",
				bits: 32,
				label: "armv7 (32-bit)",
				candidates: [
					{ architecture: "arm", variant: "v7" },
					{ architecture: "arm", variant: "v6" },
				],
			}
		: process.arch === "ia32"
			? {
					abi: "x86",
					cpu: "x86",
					bits: 32,
					label: "x86 (32-bit)",
					candidates: [{ architecture: "386" }],
				}
			: process.arch === "x64"
				? {
						abi: "x86_64",
						cpu: "amd64",
						bits: 64,
						label: "x86_64 (64-bit)",
						candidates: [{ architecture: "amd64" }, { architecture: "x86_64" }],
					}
				: {
						abi: "arm64-v8a",
						cpu: "arm64",
						bits: 64,
						label: "arm64 (64-bit)",
						candidates: [{ architecture: "arm64" }],
					};

interface Image {
	repo: string;
	tag: string;
	label: string;
	family: Family;
	/** CPUs with an official image; 64-bit-only images are hidden on 32-bit phones. */
	arches: Cpu[];
	blurb: string;
	size: string;
}

/**
 * Official Docker Hub images with a working package manager. Everything except
 * the entries marked below ships linux/arm/v7, so 32-bit phones get the same
 * choice as 64-bit ones.
 */
const IMAGES: Record<string, Image> = {
	debian: {
		repo: "library/debian",
		tag: "stable-slim",
		label: "Debian 13 (stable)",
		family: "apt",
		arches: ["armv7", "arm64", "amd64", "x86"],
		blurb: "apt + glibc. Best compatibility for pip wheels and Node native modules.",
		size: "~27 MB",
	},
	"debian-12": {
		repo: "library/debian",
		tag: "bookworm-slim",
		label: "Debian 12 (bookworm)",
		family: "apt",
		arches: ["armv7", "arm64", "amd64", "x86"],
		blurb: "Older stable release; a safe fallback for old armv7 kernels.",
		size: "~24 MB",
	},
	"debian-11": {
		repo: "library/debian",
		tag: "bullseye-slim",
		label: "Debian 11 (bullseye)",
		family: "apt",
		arches: ["armv7", "arm64", "amd64", "x86"],
		blurb: "Legacy stable; use when newer glibc does not start on your device.",
		size: "~26 MB",
	},
	"ubuntu-24.04": {
		repo: "library/ubuntu",
		tag: "24.04",
		label: "Ubuntu 24.04 LTS",
		family: "apt",
		arches: ["armv7", "arm64", "amd64"],
		blurb: "Newest LTS. Huge apt catalog and long security support.",
		size: "~27 MB",
	},
	"ubuntu-22.04": {
		repo: "library/ubuntu",
		tag: "22.04",
		label: "Ubuntu 22.04 LTS",
		family: "apt",
		arches: ["armv7", "arm64", "amd64"],
		blurb: "Widely used LTS; most tutorials and PPAs target this release.",
		size: "~27 MB",
	},
	"ubuntu-20.04": {
		repo: "library/ubuntu",
		tag: "20.04",
		label: "Ubuntu 20.04 LTS",
		family: "apt",
		arches: ["armv7", "arm64", "amd64"],
		blurb: "Older LTS for legacy software and low-memory phones.",
		size: "~24 MB",
	},
	alpine: {
		repo: "library/alpine",
		tag: "latest",
		label: "Alpine Linux",
		family: "apk",
		arches: ["armv7", "arm64", "amd64", "x86"],
		blurb: "apk + musl. Tiny and fast; some prebuilt binaries will not run.",
		size: "~4 MB",
	},
	kali: {
		repo: "kalilinux/kali-rolling",
		tag: "latest",
		label: "Kali Linux Rolling",
		family: "apt",
		arches: ["armv7", "arm64", "amd64", "x86"],
		blurb: "Security tooling on Debian testing; add tools with apt.",
		size: "~49 MB",
	},
	"kali-last": {
		repo: "kalilinux/kali-last-release",
		tag: "latest",
		label: "Kali Linux (last release)",
		family: "apt",
		arches: ["armv7", "arm64", "amd64", "x86"],
		blurb: "Kali's most recent stable snapshot, one release behind rolling.",
		size: "~49 MB",
	},
	"opensuse-tumbleweed": {
		repo: "opensuse/tumbleweed",
		tag: "latest",
		label: "openSUSE Tumbleweed",
		family: "zypper",
		arches: ["armv7", "arm64", "amd64", "x86"],
		blurb: "Rolling release with zypper and YaST; includes armv7 images.",
		size: "~36 MB",
	},
	fedora: {
		repo: "library/fedora",
		tag: "latest",
		label: "Fedora Linux",
		family: "dnf",
		arches: ["arm64", "amd64"],
		blurb: "Current Fedora with dnf. 64-bit devices only (no armv7 image).",
		size: "~66 MB",
	},
	"almalinux-9": {
		repo: "library/almalinux",
		tag: "9",
		label: "AlmaLinux 9",
		family: "dnf",
		arches: ["arm64", "amd64"],
		blurb: "RHEL-compatible enterprise base. 64-bit only.",
		size: "~71 MB",
	},
	"rocky-9": {
		repo: "library/rockylinux",
		tag: "9",
		label: "Rocky Linux 9",
		family: "dnf",
		arches: ["arm64", "amd64"],
		blurb: "RHEL-compatible enterprise base. 64-bit only.",
		size: "~64 MB",
	},
	"amazonlinux-2023": {
		repo: "library/amazonlinux",
		tag: "2023",
		label: "Amazon Linux 2023",
		family: "dnf",
		arches: ["arm64", "amd64"],
		blurb: "AWS's supported base image. 64-bit only.",
		size: "~54 MB",
	},
	"opensuse-leap": {
		repo: "opensuse/leap",
		tag: "latest",
		label: "openSUSE Leap",
		family: "zypper",
		arches: ["arm64", "amd64"],
		blurb: "Stable SUSE base with zypper. 64-bit only.",
		size: "~41 MB",
	},
	"oraclelinux-9": {
		repo: "library/oraclelinux",
		tag: "9",
		label: "Oracle Linux 9",
		family: "dnf",
		arches: ["arm64", "amd64"],
		blurb: "RHEL-compatible base from Oracle. 64-bit only.",
		size: "~92 MB",
	},
};

/** Installed right after unpacking so git, curl and TLS work from the start. */
const BASE_PACKAGES: Record<Family, string> = {
	apt: "apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client less procps",
	apk: "apk update && apk add --no-cache bash ca-certificates curl git openssh-client less procps",
	dnf: "dnf -y install ca-certificates curl git openssh-clients less procps-ng",
	zypper:
		"zypper --non-interactive --gpg-auto-import-keys refresh && zypper --non-interactive --auto-agree-with-licenses install ca-certificates curl git openssh less procps",
};

/** Optional "Termux-like" toolbox installed when the user ticks Full packages. */
const FULL_PACKAGES: Record<Family, string> = {
	apt:
		"apt-get install -y --no-install-recommends build-essential python3 python3-pip python3-venv nodejs npm wget unzip zip xz-utils jq ripgrep fd-find htop tmux nano vim-tiny",
	apk: "apk add --no-cache build-base python3 py3-pip nodejs npm wget unzip zip xz jq ripgrep fd htop tmux nano vim",
	dnf:
		"dnf -y install gcc gcc-c++ make python3 python3-pip nodejs npm wget unzip zip xz jq htop tmux nano vim-minimal",
	zypper:
		"zypper --non-interactive --auto-agree-with-licenses install gcc gcc-c++ make python3 python3-pip nodejs npm wget unzip zip xz jq ripgrep fd htop tmux nano vim",
};

interface Meta {
	distro: Distro;
	image: string;
	installedAt: number;
	full?: boolean;
}

/** undici hides the useful part of "fetch failed" in `cause`. */
function describeError(e: unknown) {
	const err = e as any;
	const cause = err?.cause;
	return (
		[err?.message, cause?.code, cause?.message, cause?.hostname ? `host ${cause.hostname}` : ""]
			.filter(Boolean)
			.join(" · ") || String(e)
	);
}

export class Container {
	private readonly root: string;
	private readonly rootfs: string;
	private readonly metaFile: string;

	constructor(filesDir: string) {
		this.root = join(filesDir, "linux");
		this.rootfs = process.env.ANDROPI_ROOTFS ?? join(this.root, "rootfs");
		this.metaFile = join(this.root, "container.json");
	}

	private meta(): Meta | null {
		try {
			return JSON.parse(readFileSync(this.metaFile, "utf8"));
		} catch {
			return null;
		}
	}

	/** The `box` launcher pi uses as its shell while the container is on. */
	get shellPath() {
		return join(process.env.PI_CODING_AGENT_DIR ?? "", "bin", "box");
	}

	status(currentShell: string | undefined) {
		const meta = this.meta();
		const installed = !!meta && existsSync(join(this.rootfs, "etc"));
		return {
			installed,
			distro: installed ? meta!.distro : null,
			distroLabel: installed ? (IMAGES[meta!.distro]?.label ?? meta!.distro) : null,
			image: installed ? meta!.image : null,
			installedAt: installed ? meta!.installedAt : null,
			full: installed ? meta!.full === true : false,
			enabled: installed && currentShell === this.shellPath,
			platform: { arch: PLATFORM.cpu, bits: PLATFORM.bits, label: PLATFORM.label, abi: PLATFORM.abi },
			distros: Object.entries(IMAGES)
				.filter(([, i]) => i.arches.includes(PLATFORM.cpu))
				.map(([id, i]) => ({
					id,
					label: i.label,
					blurb: i.blurb,
					size: i.size,
					family: i.family,
					image: `${i.repo.replace("library/", "")}:${i.tag}`,
				})),
		};
	}

	/** Keeps the container's resolver in line with the app's DNS choice. */
	setNameservers(mode: DnsMode) {
		const etc = join(this.rootfs, "etc");
		if (!existsSync(etc)) return;
		rmSync(join(etc, "resolv.conf"), { force: true });
		writeFileSync(join(etc, "resolv.conf"), NAMESERVERS[mode].map((ip) => `nameserver ${ip}`).join("\n") + "\n");
	}

	async install(distro: Distro, log: Log, dns: DnsMode = "cloudflare", full = false) {
		const image = IMAGES[distro];
		if (!image) throw new Error(`Unknown distro: ${distro}`);
		if (!image.arches.includes(PLATFORM.cpu)) {
			throw new Error(`${image.label} has no ${PLATFORM.label} image. Use a 64-bit build for this distribution.`);
		}
		rmSync(this.rootfs, { recursive: true, force: true });
		rmSync(this.metaFile, { force: true });
		mkdirSync(this.rootfs, { recursive: true });

		log(`Pulling ${image.repo.replace("library/", "")}:${image.tag} (${PLATFORM.label})…`);
		const layers = await this.resolveLayers(image.repo, image.tag);
		for (const [i, layer] of layers.entries()) {
			log(`Layer ${i + 1}/${layers.length} · ${(layer.size / 1e6).toFixed(1)} MB`);
			await this.extractLayer(image.repo, layer, log);
		}

		log("Configuring…");
		this.configure(image);
		this.setNameservers(dns);

		// proot itself must work before package managers are worth trying.
		try {
			await run("box", ["-c", "true"], { cwd: process.env.HOME ?? "/", log });
		} catch (e) {
			this.remove();
			throw new Error(`The ${PLATFORM.label} container could not start: ${String((e as Error)?.message ?? e)}`);
		}

		log("Installing base tools (git, curl, ssh, certificates)…");
		if (!(await this.packages(BASE_PACKAGES[image.family], log))) {
			log("Warning: some base packages failed; open a shell and retry the package manager.");
		}
		let fullInstalled = false;
		if (full) {
			log("Installing full developer tools (this can take a while)…");
			fullInstalled = await this.packages(FULL_PACKAGES[image.family], log);
			if (!fullInstalled) {
				log("Warning: some optional packages were unavailable for this distribution.");
			}
		}
		writeFileSync(
			this.metaFile,
			JSON.stringify({
				distro,
				image: `${image.repo.replace("library/", "")}:${image.tag}`,
				installedAt: Date.now(),
				full: fullInstalled,
			}),
		);
		log("Container ready");
		return this.status(undefined);
	}

	/** Runs a package-manager command; failures are reported in the log, not fatal. */
	private async packages(command: string, log: Log) {
		try {
			await run("box", ["-c", command], { cwd: process.env.HOME ?? "/", log });
			return true;
		} catch (e) {
			log(String((e as Error)?.message ?? e));
			return false;
		}
	}

	remove() {
		rmSync(this.rootfs, { recursive: true, force: true });
		rmSync(this.metaFile, { force: true });
	}

	// -------------------------------------------------------------------------
	// Docker Hub (anonymous pulls), with Google's mirror as a fallback for
	// networks where registry-1.docker.io or auth.docker.io is unreachable.

	private token?: string;
	private mirror = false;

	private async registry(repo: string, path: string, accept?: string): Promise<Response> {
		const headers = accept ? { Accept: accept } : undefined;
		const timeout = path.startsWith("blobs/") ? 300_000 : 45_000;
		if (this.mirror) {
			return this.fetchOk(`https://mirror.gcr.io/v2/${repo}/${path}`, { headers }, timeout, "Registry mirror");
		}
		try {
			if (!this.token) {
				const auth = await this.fetchOk(
					`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
					undefined,
					30_000,
					"Docker Hub login",
				);
				this.token = ((await auth.json()) as any).token;
				if (!this.token) throw new Error("Docker Hub login: empty token");
			}
			return await this.fetchOk(
				`https://registry-1.docker.io/v2/${repo}/${path}`,
				{ headers: { Authorization: `Bearer ${this.token}`, ...headers } },
				timeout,
				`Registry ${path}`,
			);
		} catch (e) {
			// Docker Hub is blocked, rate-limited or the connection dropped:
			// mirror.gcr.io serves the same content without authentication.
			this.mirror = true;
			this.token = undefined;
			try {
				return await this.registry(repo, path, accept);
			} catch (m) {
				throw new Error(`${describeError(e)}; mirror also failed: ${describeError(m)}`);
			}
		}
	}

	private async fetchOk(url: string, init: RequestInit | undefined, timeout: number, what: string) {
		let last: unknown;
		for (let attempt = 0; attempt < 3; attempt++) {
			let res: Response;
			try {
				res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
			} catch (e) {
				last = e;
				await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
				continue;
			}
			if (res.ok) return res;
			await res.body?.cancel().catch(() => {});
			const error = new Error(`${what}: HTTP ${res.status} ${res.statusText}`);
			if (res.status !== 429 && res.status < 500) throw error;
			last = error;
			await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
		}
		throw new Error(`${what}: ${describeError(last)}`);
	}

	private async resolveLayers(repo: string, tag: string) {
		this.token = undefined;
		this.mirror = false;
		const index = (await (
			await this.registry(
				repo,
				`manifests/${tag}`,
				"application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
			)
		).json()) as any;
		let arm: any;
		for (const c of PLATFORM.candidates) {
			arm = (index.manifests ?? []).find(
				(m: any) =>
					m.platform?.os === "linux" &&
					m.platform?.architecture === c.architecture &&
					(!c.variant || m.platform?.variant === c.variant),
			);
			if (arm) break;
		}
		if (!arm) throw new Error(`No image for ${PLATFORM.label} (tried ${PLATFORM.candidates.map((c) => c.architecture + (c.variant ? "/" + c.variant : "")).join(", ")})`);
		const manifest = (await (
			await this.registry(
				repo,
				`manifests/${arm.digest}`,
				"application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
			)
		).json()) as any;
		return (manifest.layers as any[]).map((l) => ({ digest: l.digest as string, size: l.size as number }));
	}

	private async extractLayer(repo: string, layer: { digest: string; size: number }, log: Log) {
		for (let attempt = 0; ; attempt++) {
			try {
				const res = await this.registry(repo, `blobs/${layer.digest}`);
				let received = 0;
				let lastPct = -1;
				const counted = Readable.fromWeb(res.body as any).on("data", (chunk: Buffer) => {
					received += chunk.length;
					const pct = Math.floor((received / layer.size) * 100);
					if (pct >= lastPct + 10 || pct === 100) {
						lastPct = pct;
						log(`Downloading: ${pct}%`);
					}
				});
				await untar(counted.pipe(createGunzip()), this.rootfs);
				return;
			} catch (e) {
				if (attempt > 0 || this.mirror) {
					throw new Error(`Layer ${layer.digest.slice(0, 19)}… failed: ${describeError(e)}`);
				}
				log("Download interrupted; retrying through the registry mirror…");
				this.mirror = true;
			}
		}
	}

	private configure(image: Image) {
		const etc = join(this.rootfs, "etc");
		mkdirSync(etc, { recursive: true });
		// Replace (not follow) whatever the image ships: often a symlink to /run.
		for (const [name, body] of [
			["resolv.conf", "nameserver 8.8.8.8\nnameserver 1.1.1.1\n"],
			["hosts", "127.0.0.1 localhost\n::1 localhost ip6-localhost\n"],
		]) {
			rmSync(join(etc, name), { force: true });
			writeFileSync(join(etc, name), body);
		}
		const tmp = join(this.rootfs, "tmp");
		mkdirSync(tmp, { recursive: true });
		chmodSync(tmp, 0o1777);
		if (image.family === "apt") {
			// apt drops privileges to _apt for downloads; under proot that user can't write.
			mkdirSync(join(etc, "apt/apt.conf.d"), { recursive: true });
			writeFileSync(
				join(etc, "apt/apt.conf.d/99andropi"),
				'APT::Sandbox::User "root";\nAcquire::Retries "3";\nAPT::Install-Recommends "false";\n',
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Minimal tar reader (ustar + GNU long names + PAX paths). Hardlinks become
// copies: Android app storage does not allow link().

async function untar(stream: AsyncIterable<Buffer>, dest: string) {
	let buf: Buffer = Buffer.alloc(0);
	let longName: string | null = null;
	let longLink: string | null = null;
	let pax: Record<string, string> = {};
	const links: [string, string][] = [];

	const next = async function* () {
		for await (const chunk of stream) yield chunk as Buffer;
	};
	const it = next();
	const need = async (n: number) => {
		while (buf.length < n) {
			const { value, done } = await it.next();
			if (done) return false;
			buf = buf.length ? Buffer.concat([buf, value]) : value;
		}
		return true;
	};
	const take = (n: number) => {
		const out = buf.subarray(0, n);
		buf = buf.subarray(n);
		return out;
	};
	const str = (b: Buffer, off: number, len: number) => {
		const s = b.subarray(off, off + len);
		const z = s.indexOf(0);
		return (z >= 0 ? s.subarray(0, z) : s).toString("utf8");
	};
	const safe = (name: string) => {
		const clean = normalize(name.replace(/^\.?\/+/, "")).replace(/^(\.\.(\/|$))+/, "");
		return clean && clean !== "." ? join(dest, clean) : null;
	};

	while (await need(512)) {
		const h = take(512);
		if (h.every((b) => b === 0)) continue;
		const size = parseInt(str(h, 124, 12).trim() || "0", 8);
		const type = String.fromCharCode(h[156] || 48);
		const prefix = str(h, 345, 155);
		let name = longName ?? pax.path ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
		const linkName = longLink ?? pax.linkpath ?? str(h, 157, 100);
		const mode = parseInt(str(h, 100, 8).trim() || "644", 8) & 0o7777;
		const padded = Math.ceil(size / 512) * 512;
		if (!(await need(padded))) throw new Error("Truncated layer");
		const data = take(padded).subarray(0, size);

		if (type === "L") {
			longName = str(data, 0, size);
			continue;
		}
		if (type === "K") {
			longLink = str(data, 0, size);
			continue;
		}
		if (type === "x" || type === "g") {
			if (type === "x") pax = parsePax(data);
			continue;
		}
		longName = longLink = null;
		pax = {};

		// OCI whiteouts remove entries inherited from lower layers.
		const base = name.split("/").pop() ?? "";
		const path = safe(name);
		if (!path) continue;
		if (base === ".wh..wh..opq") {
			const dir = safe(name.slice(0, -base.length));
			if (dir) {
				rmSync(dir, { recursive: true, force: true });
				mkdirSync(dir, { recursive: true });
			}
			continue;
		}
		if (base.startsWith(".wh.")) {
			rmSync(join(dirname(path), base.slice(4)), { recursive: true, force: true });
			continue;
		}
		mkdirSync(dirname(path), { recursive: true });

		switch (type) {
			case "5":
				mkdirSync(path, { recursive: true });
				chmodSync(path, mode | 0o700);
				break;
			case "2":
				rmSync(path, { force: true });
				symlinkSync(linkName, path);
				break;
			case "1":
				links.push([path, linkName]);
				break;
			case "0":
			case "7":
			case "\0":
				rmSync(path, { force: true });
				writeFileSync(path, data);
				chmodSync(path, mode | 0o600);
				break;
			default:
				// Devices and FIFOs: /dev is bind-mounted from the host.
				break;
		}
	}
	for (const [path, target] of links) {
		const from = safe(target);
		if (!from || !existsSync(from) || lstatSync(from).isDirectory()) continue;
		rmSync(path, { force: true });
		copyFileSync(from, path);
		chmodSync(path, statSync(from).mode & 0o7777);
	}
}

function parsePax(data: Buffer) {
	const out: Record<string, string> = {};
	let pos = 0;
	while (pos < data.length) {
		const sp = data.indexOf(0x20, pos);
		if (sp < 0) break;
		const len = parseInt(data.subarray(pos, sp).toString(), 10);
		if (!len) break;
		const record = data.subarray(sp + 1, pos + len - 1).toString("utf8");
		const eq = record.indexOf("=");
		if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
		pos += len;
	}
	return out;
}
