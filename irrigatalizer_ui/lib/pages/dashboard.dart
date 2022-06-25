import 'package:flutter/material.dart';
import 'package:irrigatalizer_ui/icons.dart';
import 'package:irrigatalizer_ui/pages/page.dart';
import 'package:provider/provider.dart';

import '../model/dashboard.dart';

Widget dashboardPage(BuildContext context) => BasicPage(
    title: "Dashboard", content: (_) => const Dashboard(key: Key("dashboard")));

class Dashboard extends StatelessWidget {
  const Dashboard({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
        create: (context) {
          final model = DashboardModel();
          model.load();
          return model;
        },
        builder: (context, _) => _build(context));
  }

  Widget _build(BuildContext context) {
    return Consumer<DashboardModel>(builder: (context, model, child) {
      if (model.loading) {
        return const Center(child: CircularProgressIndicator());
      }
      return _content(context, model);
    });
  }

  Widget _content(BuildContext context, DashboardModel model) {
    return Column(children: [
      Row(children: [
        const Text("Status:"),
        model.status?.current == null ? icons.waterOff() : icons.waterOn()
      ])
    ]);
  }
}
