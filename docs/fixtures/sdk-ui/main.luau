local Game = {}
function Game.start(api)
    api.ui.setRoot({kind="screen",id="probe",node="probe",children={
        {kind="image",id="art",asset="asset://probe",fit="contain",rect={x=10,y=20,width=80,height=60}},
        {kind="button",id="hold",text="",action="ProbeHold",rect={x=10,y=20,width=80,height=60}}
    }})
end
function Game.update(api) end
return Game
