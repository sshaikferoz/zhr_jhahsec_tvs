sap.ui.define(["sap/m/MessageToast"], function (MessageToast) {
  "use strict";

  function navigate(sSemanticObject) {
    var oCrossAppNavigator =
      sap.ushell &&
      sap.ushell.Container &&
      sap.ushell.Container.getService("CrossApplicationNavigation");
    if (oCrossAppNavigator) {
      oCrossAppNavigator.toExternal({
        target: {
          semanticObject: sSemanticObject,
          action: "manage",
        },
      });
    } else {
      MessageToast.show(
        "Cross-App Navigation is not supported in this environment.",
      );
    }
  }

  return {
    navigateToMaintainLocation: function () {
      navigate("MaintLocnType");
    },
    navigateToMaintainViolationType: function () {
      navigate("MaintViolType");
    },
    navigateToMaintainWFRule: function () {
      navigate("maintwfruletvs");
    },
    navigateToMaintainWFAdmin: function () {
      navigate("maintwfadmin");
    },
  };
});
