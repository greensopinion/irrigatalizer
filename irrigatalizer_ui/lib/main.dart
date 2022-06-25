import 'package:flutter/material.dart';
import 'package:irrigatalizer_ui/pages/dashboard.dart';

import 'navigation.dart';

void main() {
  runApp(const App());
}

class App extends StatelessWidget {
  const App({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Irrigatalizer',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      routes: appRoutes,
      home: AppRoute.DASHBOARD.builder(context),
    );
  }
}
