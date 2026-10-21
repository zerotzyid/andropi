import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:simple_icons/simple_icons.dart';

import '../agent/agent_controller.dart';
import '../agent/integrations.dart';
import 'kit.dart';
import 'task_log.dart';
import 'terminal_screen.dart';
import 'theme.dart';

/// Icon for a distro id (also used by the settings overview).
IconData containerDistroIcon(String? id) {
  if (id == null) return LucideIcons.container;
  if (id.startsWith('ubuntu')) return SimpleIcons.ubuntu;
  if (id.startsWith('debian')) return SimpleIcons.debian;
  if (id.startsWith('alpine')) return SimpleIcons.alpinelinux;
  if (id.startsWith('kali')) return SimpleIcons.kalilinux;
  if (id.startsWith('fedora')) return SimpleIcons.fedora;
  if (id.startsWith('opensuse')) return SimpleIcons.opensuse;
  if (id.startsWith('rocky')) return SimpleIcons.rockylinux;
  if (id.startsWith('alma')) return SimpleIcons.almalinux;
  return LucideIcons.container;
}

Color containerDistroColor(String? id) {
  if (id == null) return const Color(0xFF8B5CF6);
  if (id.startsWith('ubuntu')) return const Color(0xFFE95420);
  if (id.startsWith('debian')) return const Color(0xFFD70A53);
  if (id.startsWith('alpine')) return const Color(0xFF0D597F);
  if (id.startsWith('kali')) return const Color(0xFF557C94);
  if (id.startsWith('fedora')) return const Color(0xFF51A2DA);
  if (id.startsWith('opensuse')) return const Color(0xFF73BA25);
  if (id.startsWith('rocky')) return const Color(0xFF10B981);
  if (id.startsWith('alma')) return const Color(0xFF0F4266);
  return const Color(0xFF8B5CF6);
}

/// One Docker image from the host's catalog (shown only for this device's CPU).
class _Distro {
  _Distro(this.json);
  final Map<String, dynamic> json;

  String get id => '${json['id']}';
  String get name => '${json['label'] ?? json['id']}';
  String get blurb => '${json['blurb'] ?? ''}';
  String get size => '${json['size'] ?? ''}';
  String get family => '${json['family'] ?? 'apt'}';

  IconData get icon => containerDistroIcon(id);

  Color get color => containerDistroColor(id);

  String get hint => switch (family) {
        'apk' => 'apk add python3 py3-pip nodejs npm build-base',
        'dnf' => 'dnf install -y python3 nodejs npm gcc gcc-c++ make',
        'zypper' => 'zypper install -y python3 nodejs npm gcc gcc-c++ make',
        _ => 'apt-get update\napt-get install -y python3 python3-pip nodejs npm build-essential',
      };
}

/// Install and manage the Linux userland the agent can use.
class ContainerScreen extends StatefulWidget {
  const ContainerScreen({super.key, required this.agent});
  final AgentController agent;

  @override
  State<ContainerScreen> createState() => _ContainerScreenState();
}

class _ContainerScreenState extends State<ContainerScreen> {
  Integrations get it => widget.agent.integrations;
  String? choice;
  bool full = true;
  bool switching = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final status = await it.refreshContainer();
      if (!mounted) return;
      if (choice == null && status.distros.isNotEmpty) {
        setState(() => choice = _Distro(status.distros.first).id);
      }
    } catch (_) {
      // The host may still be starting; the listenable will refresh it later.
    }
  }

  Future<void> _install(_Distro d) async {
    final ok = await runWithLog<bool>(
      context,
      title: 'Installing ${d.name}',
      task: (log, _) async {
        await it.installContainer(d.id, full: full, onLine: log);
        return true;
      },
    );
    if (ok == true && mounted) await _setShell(true);
  }

  Future<void> _setShell(bool on) async {
    setState(() => switching = true);
    try {
      await it.setContainerShell(on);
      await widget.agent.refreshState();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => switching = false);
    }
  }

  Future<void> _remove() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove the container?'),
        content: const Text('Everything installed inside it is deleted. Your workspace files are kept.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: context.palette.danger, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (yes != true) return;
    await it.removeContainer();
    await widget.agent.refreshState();
  }

  _Distro? _selected(List<_Distro> distros, ContainerStatus c) {
    final id = c.installed ? c.distro : choice;
    for (final d in distros) {
      if (d.id == id) return d;
    }
    return distros.isEmpty ? null : distros.first;
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return ListenableBuilder(
      listenable: it,
      builder: (context, _) {
        final c = it.container;
        final distros = c == null ? const <_Distro>[] : c.distros.map(_Distro.new).toList();
        final installed = c?.installed == true;
        final d = c == null ? null : _selected(distros, c);
        return Scaffold(
          appBar: AppBar(title: const Text('Linux container')),
          body: c == null
              ? const Center(child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 40),
                  children: [
                    SurfaceCard(
                      highlight: installed && c.enabled,
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              IconTile(
                                icon: installed && d != null ? d.icon : LucideIcons.container,
                                color: installed && d != null ? d.color : p.accent,
                                size: 48,
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      installed ? (c.distroLabel ?? d?.name ?? 'Linux') : 'Real Linux on your phone',
                                      style: text.titleMedium,
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      installed
                                          ? '${c.image ?? ''} · ${c.archLabel}${c.full ? ' · full tools' : ''}'
                                          : 'Images compatible with ${c.archLabel}',
                                      style: TextStyle(
                                        fontFamily: installed ? mono : null,
                                        fontSize: 12.5,
                                        color: p.muted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (installed)
                                Pill(
                                  c.enabled ? 'Agent shell' : 'Installed',
                                  color: c.enabled ? p.success : p.muted,
                                  dot: true,
                                ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Text(
                            installed
                                ? 'Runs through proot: no root or Termux needed. Your home folder and workspace are the same '
                                    'paths inside, so the agent can use its package manager and work on your files directly.'
                                : 'Runs through proot: no root or Termux needed. Pick any distribution; only images with an '
                                    'official build for your CPU are listed.',
                            style: text.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    if (!installed) ...[
                      SectionLabel('Choose a distribution · ${c.archLabel}'),
                      if (distros.isEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                          child: Text('No container images are available for this CPU.', style: text.bodySmall),
                        ),
                      for (final x in distros) ...[
                        _DistroCard(distro: x, selected: d?.id == x.id, onTap: () => setState(() => choice = x.id)),
                        const SizedBox(height: 10),
                      ],
                      const SizedBox(height: 6),
                      const SectionLabel('Packages'),
                      SettingsGroup(
                        children: [
                          SettingsRow(
                            icon: LucideIcons.package,
                            color: p.accentAlt,
                            title: 'Full developer tools',
                            subtitle: 'Python, Node.js, compilers and CLIs (like Termux; adds up to ~1 GB)',
                            trailing: Switch(value: full, onChanged: (v) => setState(() => full = v)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      PrimaryButton(
                        label: 'Install ${d?.name ?? 'Linux'}',
                        icon: LucideIcons.download,
                        onPressed: d == null ? null : () => _install(d),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'Downloads ${d?.name ?? 'the image'} from Docker Hub for ${c.archLabel}, then installs '
                        '${full ? 'the full toolset.' : 'git, curl, ssh and certificates.'}',
                        textAlign: TextAlign.center,
                        style: text.bodySmall,
                      ),
                    ] else ...[
                      const SectionLabel('Agent'),
                      SettingsGroup(
                        children: [
                          SettingsRow(
                            icon: LucideIcons.squareTerminal,
                            color: p.accent,
                            title: 'Use as the agent\'s shell',
                            subtitle: c.enabled
                                ? 'Every command pi runs happens inside ${c.distroLabel ?? 'Linux'}'
                                : 'pi uses the Android shell; `box` still reaches Linux',
                            trailing: switching
                                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                : Switch(value: c.enabled, onChanged: widget.agent.busy ? null : _setShell),
                          ),
                          SettingsRow(
                            icon: LucideIcons.terminal,
                            color: const Color(0xFF22C55E),
                            title: 'Open a Linux shell',
                            subtitle: 'Terminal inside the container',
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => TerminalScreen(agent: widget.agent, command: 'box'),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SectionLabel('Try'),
                      SurfaceCard(
                        padding: const EdgeInsets.all(14),
                        child: SelectableText(
                          d?.hint ?? 'apt-get update',
                          style: TextStyle(fontFamily: mono, fontSize: 12.5, height: 1.6, color: p.text),
                        ),
                      ),
                      const SectionLabel('Manage'),
                      SettingsGroup(
                        children: [
                          SettingsRow(
                            icon: LucideIcons.trash2,
                            color: p.danger,
                            title: 'Remove container',
                            subtitle: 'Frees the space; workspace files stay',
                            destructive: true,
                            onTap: widget.agent.busy ? null : _remove,
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
        );
      },
    );
  }
}

class _DistroCard extends StatelessWidget {
  const _DistroCard({required this.distro, required this.selected, required this.onTap});
  final _Distro distro;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return SurfaceCard(
      highlight: selected,
      onTap: onTap,
      child: Row(
        children: [
          IconTile(icon: distro.icon, color: distro.color, size: 44),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(child: Text(distro.name, style: text.titleSmall)),
                    const SizedBox(width: 8),
                    Text(
                      distro.size,
                      style: TextStyle(fontFamily: mono, fontSize: 11, color: p.faint),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(distro.blurb, style: text.bodySmall),
              ],
            ),
          ),
          const SizedBox(width: 8),
          AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: selected ? p.accent : null,
              border: selected ? null : Border.all(color: p.border, width: 2),
            ),
            child: selected ? const Icon(LucideIcons.check, size: 13, color: Colors.white) : null,
          ),
        ],
      ),
    );
  }
}
