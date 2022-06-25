import 'package:flutter/material.dart';
import 'package:irrigatalizer_ui/pages/dashboard.dart';

class AppRoute {
  final String name;
  final WidgetBuilder builder;

  const AppRoute(this.name, this.builder);

  static const DASHBOARD = AppRoute("dashboard", dashboardPage);
}

final _allRoutes = [AppRoute.DASHBOARD];

final appRoutes = {for (final it in _allRoutes) it.name: it.builder};
