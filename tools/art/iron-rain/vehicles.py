"""Original fictional yard vehicles, in Blender metres. Parked scenery, no drive system.
Installed into the standard IRON RAIN generator; shares its materials/export path.
"""
import math


def install(g):
    global reset, box, C, T, R, E, M, curve, label, finish, L
    reset, box, C, T, R, E, M, curve, label, finish, L = [g[k] for k in
        ('reset', 'box', 'C', 'T', 'R', 'E', 'M', 'curve', 'label', 'finish', 'L')]


def jeep():
    reset()
    box('Ladder chassis', (0, 0, .48), (1.85, 4.1, .22), 'ir_steel')
    box('Utility tub', (0, .4, .91), (1.88, 2.9, .55), 'ir_canvas')
    box('Long engine hood', (0, -1.38, 1.12), (1.82, 1.35, .4), 'ir_canvas')
    for side in (-1, 1):
        for y in (-1.38, 1.4):
            C('All terrain tire', (side*.98, y, .5), .5, .34, 'ir_rubber', 'X', 24)
            C('Wheel rim', (side*1.16, y, .5), .28, .025, 'ir_steel', 'X', 20)
            for i in range(18):
                a=i*math.tau/18
                t=box('Tread block', (side*.99,y+.48*math.sin(a),.5+.48*math.cos(a)),(.35,.15,.065),'ir_rubber')
                t.rotation_euler.x=-a
            box('Wheel fender', (side*.98,y,1.03),(.3,1.18,.12),'ir_canvas')
        box('Door panel', (side*.96,.05,1.14),(.065,1.2,.48),'ir_canvas')
        box('Door handle', (side*1.01,.42,1.32),(.03,.19,.035),'ir_steel')
        R('Roll cage upright', (side*.88,-.57,1.14),(side*.88,-.4,1.9),.04,'ir_steel')
        R('Rear cage upright', (side*.88,1.55,1.14),(side*.88,1.4,1.9),.04,'ir_steel')
        R('Roof rail', (side*.88,-.4,1.9),(side*.88,1.4,1.9),.04,'ir_steel')
        box('Seat back', (side*.46,.45,1.23),(.62,.22,.62),'ir_rubber')
        box('Seat cushion', (side*.46,.16,.95),(.62,.6,.15),'ir_rubber')
        C('Headlight', (side*.66,-2.09,1.14),.15,.045,'ir_light','Y',20)
        box('Rear lamp',(side*.77,1.91,.95),(.16,.035,.16),'ir_orange')
    box('Canvas roof', (0,.5,1.94),(1.9,2.05,.09),'ir_canvas')
    glass=box('Windshield',(0,-.49,1.59),(1.66,.03,.56),'ir_glass');glass.rotation_euler.x=-.22
    R('Windshield divider',(0,-.57,1.32),(0,-.43,1.91),.025,'ir_steel')
    for x in [-.4,-.2,0,.2,.4]:box('Grille slot',(x,-2.065,1.08),(.075,.03,.3),'ir_rubber')
    box('Front bumper',(0,-2.15,.64),(2.22,.1,.17),'ir_steel')
    C('Rear spare',(0,2.02,1.15),.44,.3,'ir_rubber','Y',24)
    C('Spare rim',(0,2.18,1.15),.25,.025,'ir_steel','Y',20)
    label('07',(-.37,-1.4,1.34),.22)
    finish('jeep',((0,0,.95),(2.3,4.4,1.9)))


def helicopter():
    reset()
    M.hull('Utility cabin',[(-2.7,.65,.9,1.5),(-1.9,1.17,.6,2.45),(.3,1.28,.58,2.75),(2.7,.7,1,2.3)],'ir_plaster',.08)
    # Faceted dark cockpit panes and distinct blue sliding cargo doors.
    for side in (-1,1):
        pane=box('Cockpit glazing',(side*.51,-2.40,1.91),(.94,.04,.76),'ir_glass');pane.rotation_euler.x=-.70
        box('Pilot side window',(side*1.25,-1.2,1.98),(.035,.84,.66),'ir_glass')
        box('Sliding door',(side*1.27,.45,1.58),(.04,1.75,1.57),'ir_blue')
        box('Cabin window',(side*1.30,.4,1.98),(.02,1.16,.49),'ir_glass')
        box('Door handle',(side*1.32,-.12,1.35),(.03,.24,.045),'ir_white')
        R('Door runner',(side*1.3,-.4,2.47),(side*1.3,1.5,2.47),.025,'ir_steel')
        curve('Landing skid',[(side*1.35,-2.6,.3),(side*1.35,-2.2,.13),(side*1.35,2.3,.13)],.07,'ir_steel')
        for y in (-1.4,1.5):R('Skid support',(side*.7,y,.77),(side*1.35,y,.17),.055,'ir_steel')
        E('Engine cowling',(side*.49,.8,2.83),(.4,1.45,.36),'ir_blue',20,12)
        C('Exhaust',(side*.5,1.95,2.87),.21,.48,'ir_steel','Y',20)
    M.hull('Tapered tail boom',[(2.5,.32,1.65,2.3),(5.5,.19,1.92,2.27),(7,.12,2.05,2.3)],'ir_blue',.025)
    box('Tail stabilizer',(0,5.8,2.15),(2.25,.6,.07),'ir_blue')
    fin=box('Tail fin',(0,6.58,2.76),(.09,1.02,1.28),'ir_blue');fin.rotation_euler.x=-.25
    C('Rotor mast',(0,.3,3.25),.10,.85,'ir_steel','Z',16)
    C('Rotor hub',(0,.3,3.61),.28,.16,'ir_steel','Z',20)
    for a in (math.pi*.16, math.pi*.66):
        blade=box('Parked main rotor',(0,.3,3.65),(11.8,.24,.055),'ir_rubber');blade.rotation_euler.z=a
        for sign in (-1,1):
            tip=box('Rotor warning tip',(sign*5.5*math.cos(a),.3+sign*5.5*math.sin(a),3.66),(.65,.25,.06),'ir_mark');tip.rotation_euler.z=a
    C('Tail rotor axle',(.2,6.55,2.65),.08,.5,'ir_steel','X',12)
    for a in (.3, math.pi/2+.3):
        blade=box('Tail rotor',(.48,6.55,2.65),(.045,1.7,.13),'ir_rubber');blade.rotation_euler.x=a
    L.add_collider('tail',(0,4.85,1.975),(.64,4.3,.65))
    finish('helicopter',((0,0,1.4),(2.7,5.4,2.8)))
