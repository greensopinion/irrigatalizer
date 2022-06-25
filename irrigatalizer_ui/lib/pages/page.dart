import 'package:flutter/material.dart';

class BasicPage extends StatelessWidget {
  final String title;
  final WidgetBuilder content;

  const BasicPage({super.key, required this.title, required this.content});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text("Irrigatalizer: $title"),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: content(context),
      ),
    );
  }
}
