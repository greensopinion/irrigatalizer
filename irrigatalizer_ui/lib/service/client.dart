import 'api_model.dart';

class Client {
  Future<Status> retrieveStatus() async {
    await Future.delayed(Duration(seconds: 2));
    return Status(
        current: Cycle(
            circuit: "First",
            start: DateTime.now().subtract(Duration(minutes: 3)),
            end: DateTime.now().add(Duration(minutes: 2))),
        next: Cycle(
            circuit: "Second",
            start: DateTime.now().add(Duration(minutes: 2)),
            end: DateTime.now().add(Duration(minutes: 5))));
  }
}
