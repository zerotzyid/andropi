import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../agent/agent_controller.dart';
import 'kit.dart';
import 'theme.dart';

/// Add or edit an endpoint that speaks one of pi's supported model APIs.
class CustomProviderScreen extends StatefulWidget {
  const CustomProviderScreen({super.key, required this.agent, this.provider});
  final AgentController agent;
  final Map<String, dynamic>? provider;

  @override
  State<CustomProviderScreen> createState() => _CustomProviderScreenState();
}

class _CustomProviderScreenState extends State<CustomProviderScreen> {
  static const _apis = {
    'openai-completions': 'OpenAI · Chat Completions',
    'openai-responses': 'OpenAI · Responses',
    'anthropic-messages': 'Anthropic · Messages',
    'google-generative-ai': 'Google · Generative AI',
    'mistral-conversations': 'Mistral · Conversations',
  };

  final id = TextEditingController();
  final name = TextEditingController();
  final baseUrl = TextEditingController();
  final apiKey = TextEditingController();
  final models = TextEditingController();
  final contextWindow = TextEditingController();
  final maxTokens = TextEditingController();

  String api = 'openai-completions';
  bool reasoning = false;
  bool vision = false;
  bool saving = false;
  String? error;

  bool get editing => widget.provider != null;
  bool get hasKey => widget.provider?['hasKey'] == true;

  @override
  void initState() {
    super.initState();
    final p = widget.provider;
    if (p == null) {
      contextWindow.text = '128000';
      maxTokens.text = '8192';
      return;
    }
    id.text = '${p['provider'] ?? ''}';
    name.text = '${p['name'] ?? ''}';
    baseUrl.text = '${p['baseUrl'] ?? ''}';
    models.text = (p['models'] as List? ?? const []).map((m) => '$m').join(', ');
    contextWindow.text = '${p['contextWindow'] ?? 128000}';
    maxTokens.text = '${p['maxTokens'] ?? 8192}';
    reasoning = p['reasoning'] == true;
    vision = p['vision'] == true;
    final savedApi = '${p['api'] ?? 'openai-completions'}';
    api = _apis.containsKey(savedApi) ? savedApi : 'openai-completions';
  }

  @override
  void dispose() {
    id.dispose();
    name.dispose();
    baseUrl.dispose();
    apiKey.dispose();
    models.dispose();
    contextWindow.dispose();
    maxTokens.dispose();
    super.dispose();
  }

  String? _validate() {
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]*$').hasMatch(id.text.trim())) {
      return 'Provider ID may only contain letters, numbers, dots, dashes and underscores.';
    }
    final uri = Uri.tryParse(baseUrl.text.trim());
    if (uri == null || !(uri.isScheme('http') || uri.isScheme('https')) || uri.host.isEmpty) {
      return 'Base URL must start with http:// or https://';
    }
    if (apiKey.text.trim().isEmpty && !hasKey) return 'API key is required.';
    if (models.text.split(RegExp(r'[\s,]+')).where((m) => m.trim().isNotEmpty).isEmpty) {
      return 'Add at least one model ID.';
    }
    for (final field in [contextWindow, maxTokens]) {
      final value = int.tryParse(field.text.trim());
      if (value == null || value <= 0) return 'Context window and max tokens must be positive numbers.';
    }
    return null;
  }

  Future<void> _save() async {
    final problem = _validate();
    if (problem != null) {
      setState(() => error = problem);
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.agent.integrations.saveCustomProvider({
        'provider': id.text.trim(),
        'name': name.text.trim(),
        'baseUrl': baseUrl.text.trim(),
        'api': api,
        'apiKey': apiKey.text.trim(),
        'models': models.text.split(RegExp(r'[\s,]+')).where((m) => m.trim().isNotEmpty).map((m) => m.trim()).toList(),
        'contextWindow': int.parse(contextWindow.text.trim()),
        'maxTokens': int.parse(maxTokens.text.trim()),
        'reasoning': reasoning,
        'vision': vision,
      });
      await widget.agent.refreshProviders();
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove provider?'),
        content: Text('${name.text.trim().isEmpty ? id.text.trim() : name.text.trim()} and its saved key will be removed.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: context.palette.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.agent.integrations.deleteCustomProvider(id.text.trim());
      await widget.agent.refreshProviders();
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(editing ? 'Edit custom provider' : 'Add custom provider'),
        actions: [
          if (editing)
            IconButton(
              tooltip: 'Remove',
              onPressed: saving ? null : _delete,
              icon: const Icon(LucideIcons.trash2),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 40),
        children: [
          const SectionLabel('Connection', padding: EdgeInsets.fromLTRB(4, 8, 4, 10)),
          _Field(
            controller: id,
            label: 'Provider ID',
            hint: 'my-gateway',
            helper: 'Unique ID used in sessions. Letters, numbers, dots, dashes and underscores.',
            enabled: !editing,
          ),
          const SizedBox(height: 12),
          _Field(controller: name, label: 'Display name', hint: 'My gateway'),
          const SizedBox(height: 12),
          _Field(
            controller: baseUrl,
            label: 'Base URL',
            hint: 'https://api.example.com/v1',
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: api,
            decoration: const InputDecoration(labelText: 'API format'),
            items: [
              for (final entry in _apis.entries)
                DropdownMenuItem(value: entry.key, child: Text(entry.value)),
            ],
            onChanged: saving ? null : (value) => setState(() => api = value ?? api),
          ),
          const SizedBox(height: 12),
          _Field(
            controller: apiKey,
            label: 'API key',
            hint: hasKey ? 'Saved key' : 'sk-…',
            helper: hasKey ? 'A key is saved. Leave blank to keep it.' : 'Stored encrypted on this device.',
            obscure: true,
          ),
          const SectionLabel('Models'),
          _Field(
            controller: models,
            label: 'Model IDs',
            hint: 'gpt-4o-mini, my-model',
            helper: 'Comma or line separated. These are sent to the endpoint as model names.',
            maxLines: 3,
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _Field(
                  controller: contextWindow,
                  label: 'Context window',
                  keyboardType: TextInputType.number,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _Field(
                  controller: maxTokens,
                  label: 'Max output tokens',
                  keyboardType: TextInputType.number,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SurfaceCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                SwitchListTile(
                  title: Text('Reasoning model', style: text.titleSmall),
                  subtitle: Text('Enable thinking levels for models that support them', style: text.bodySmall),
                  value: reasoning,
                  onChanged: saving ? null : (v) => setState(() => reasoning = v),
                ),
                Divider(height: 1, indent: 16, endIndent: 16, color: p.border),
                SwitchListTile(
                  title: Text('Accepts images', style: text.titleSmall),
                  subtitle: Text('Allow screenshots and image attachments', style: text.bodySmall),
                  value: vision,
                  onChanged: saving ? null : (v) => setState(() => vision = v),
                ),
              ],
            ),
          ),
          if (error != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: p.danger.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: p.danger.withValues(alpha: 0.3)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(LucideIcons.triangleAlert, size: 16, color: p.danger),
                  const SizedBox(width: 8),
                  Expanded(child: Text(error!, style: text.bodySmall?.copyWith(color: p.danger))),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          PrimaryButton(
            label: editing ? 'Save changes' : 'Add provider',
            icon: editing ? LucideIcons.check : LucideIcons.plus,
            busy: saving,
            onPressed: saving ? null : _save,
          ),
          const SizedBox(height: 12),
          Text(
            'Use an OpenAI-compatible endpoint for most gateways, local servers and proxies. Pricing is not '
            'reported by custom endpoints, so cost tracking stays at zero.',
            style: text.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    this.hint,
    this.helper,
    this.obscure = false,
    this.maxLines = 1,
    this.keyboardType,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String label;
  final String? hint;
  final String? helper;
  final bool obscure;
  final int maxLines;
  final TextInputType? keyboardType;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscure,
      autocorrect: false,
      enableSuggestions: !obscure,
      maxLines: obscure ? 1 : maxLines,
      keyboardType: keyboardType,
      enabled: enabled,
      style: maxLines > 1 ? const TextStyle(fontFamily: mono, fontSize: 13) : null,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        helperText: helper,
        helperMaxLines: 3,
      ),
    );
  }
}
