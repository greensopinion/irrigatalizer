import 'package:irrigatalizer_ui/service/client.dart';

import '../service/api_model.dart';
import './model.dart';

class DashboardModel extends LoadingModel<DashboardModel> {
  Status? _status;

  DashboardModel() : super((model) => model._load());

  Status? get status => _status;

  Future<void> _load() async {
    _status = await Client().retrieveStatus();
  }
}
