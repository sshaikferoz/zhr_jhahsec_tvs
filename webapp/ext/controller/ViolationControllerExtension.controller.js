sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension"
], function (ControllerExtension) {
    "use strict";

    return ControllerExtension.extend("com.jhah.zhrjhahsectvs.ext.controller.ViolationControllerExtension", {
        
        override: {
            onInit: function () {
                var oExtension = this;

                try {
                    oExtension.base.getView().addEventDelegate({
                        onAfterRendering: function () {
                            try {
                                var oModel = oExtension.base.getExtensionAPI().getModel();
                                var oListBinding = oModel.bindList("/authInfo");
                                
                                oListBinding.requestContexts(0, 1).then(function (aContexts) {
                                    if (aContexts && aContexts.length > 0) {
                                        var oUserData = aContexts[0].getObject();
                                        
                                        if (oUserData.IsAdmin === false) {
                                            console.log("User is Employee.");
                                            
                                            // Apply css to all buttons - if employee
                                            document.body.classList.add("employeeMode");
                                            
                                        } else {
                                            console.log("User is Admin.");
                                        }
                                    }
                                }).catch(function () {});
                            } catch (err) {}
                        }
                    }); 
                } catch (err) {}
            }
        }
    });
});