"""Game-owned low-poly forest geometry; no collision/gameplay changes here."""
import math, random
def build_forest(Mesh):
    m=Mesh();rng=random.Random(418)
    # Quiet olive paper ground lets cream silhouettes and orange prizes read.
    greens=[(153,157,104),(155,158,105),(151,155,103),(154,157,103)]
    # Jittered terrain vertices avoid straight grid seams and radial spokes.
    grid=[]
    for iz in range(25):
        row=[]
        for ix in range(33):
            x=-32+ix*2+rng.uniform(-.65,.65);z=-24+iz*2+rng.uniform(-.65,.65)
            row.append((x,-.055 if abs(x)<8.5 and abs(z)<8.5 else rng.uniform(-.22,-.07),z))
        grid.append(row)
    for iz in range(24):
        for ix in range(32):
            col=rng.choice(greens if 11<ix<21 and 7<iz<17 else [(111,124,92),(115,127,95),(119,129,94)])
            m.quad(grid[iz][ix],grid[iz+1][ix],grid[iz+1][ix+1],grid[iz][ix+1],col)
    # Painted moss islands, sparse flowers and leafy shade in the clearing.
    # Decorative only; the entire 25 x 25 collision floor remains flat in Luau.
    for i in range(34):
        x=rng.uniform(-8.2,8.2);z=rng.uniform(-8.2,8.2)
        if abs(x)<2 and z>5.5:continue
        edge=max(abs(x),abs(z));r=rng.uniform(.18,.65)
        col=rng.choice([(147,151,98),(150,153,100),(162,161,111)])
        radii=[r*rng.uniform(.6,1.2) for _ in range(7)]
        for k in range(7):
            a=k*math.tau/7;b=(k+1)*math.tau/7
            ra=radii[k];rb=radii[(k+1)%7]
            m.tri((x,-.03,z),(x+math.cos(a)*ra,-.03,z+math.sin(a)*ra*.6),(x+math.cos(b)*rb,-.03,z+math.sin(b)*rb*.6),col)
        if edge>5.7:
            for k in range(3):
                a=k*2.1;m.tri((x-.035,.0,z),(x+.035,.0,z),(x+math.cos(a)*.1,.18,z+math.sin(a)*.1),(121,131,84))
            if i%4==0:m.cone(x,.12,z,.055,.08,(241,202,123) if i%8 else (214,139,139),5,.025)
    # Leaf-shaped shadows break up the large field without a checkerboard pattern.
    for sign in [-1,1]:
        for i in range(5):
            x=sign*rng.uniform(5.9,7.6);z=-7+i*2.8+rng.uniform(-.7,.7)
            r=rng.uniform(.8,1.5);radii=[r*rng.uniform(.5,1.3) for _ in range(13)]
            for k in range(13):
                a=k*math.tau/13;b=(k+1)*math.tau/13;ra=radii[k];rb=radii[(k+1)%13]
                m.tri((x,-.022,z),(x+math.cos(a)*ra,-.022,z+math.sin(a)*ra*.5),(x+math.cos(b)*rb,-.022,z+math.sin(b)*rb*.5),(132,139,96))
    # Scattered undergrowth; no continuous decorative border.
    for i in range(220):
        x=rng.uniform(-17,17);z=rng.uniform(-15,15)
        if abs(x)<8.4 and abs(z)<8.4:continue
        if i%3==0:m.cone(x,-.07,z,rng.uniform(.18,.4),rng.uniform(.16,.38),rng.choice([(65,100,99),(95,126,116),(126,151,132)]),7,.12)
        else:
            for k in range(3):
                a=k*2.1;m.tri((x-.09,0,z),(x+.09,0,z),(x+math.cos(a)*.25,.38,z+math.sin(a)*.25),(61,147,111))
        if i%7==0:
            m.cone(x,.12,z,.1,.18,(242,206,133),5,.12)
    # A shallow stream outside the playable clearing.
    for i in range(20):
        z=-19+i*1.8;x=-14+math.sin(i*.48)*1.2;nx=-14+math.sin((i+1)*.48)*1.2
        m.quad((x-1.2,-.025,z),(nx-1.2,-.025,z+1.8),(nx+1.2,-.025,z+1.8),(x+1.2,-.025,z),(53,143,151))
        if i%2==0:m.box(x,.015,z,.9,.025,.055,(181,218,194))
    for i in range(74):
        x=rng.uniform(-24,24);z=rng.uniform(-22,18)
        if abs(x)<9.5 and -9.5<z<9.5:continue
        if z>8 and abs(x)<9:continue  # Keep the foreground and central cannon readable.
        h=rng.uniform(3.1,5.4)*(1 if z<0 else .7);r=rng.uniform(.9,1.6)
        trunk=rng.choice([(79,73,62),(104,88,63),(67,80,71)])
        m.cone(x,-.1,z,.24,h*.67,trunk,6,.13)
        leaf=rng.choice([(79,94,72),(94,109,77),(112,123,82),(136,143,91),(153,153,98)])
        if i%3==0:
            for k in range(3):m.cone(x,h*(.27+k*.19),z,r*(1-k*.21),h*.42,tuple(min(255,c+k*9) for c in leaf),7,.02)
        else:
            for ox,oy,oz,scale in [(0,.68,0,1),(-.6,.52,.15,.7),(.6,.53,-.15,.7)]:
                m.cone(x+ox,h*oy,z+oz,r*scale,h*.17,leaf,7,r*scale*.7)
                m.cone(x+ox,h*(oy+.17),z+oz,r*scale*.7,h*.19,leaf,7,.06)
    # Deliberately composed canopy behind the far wall; varied heights and hues.
    for i,x in enumerate([-10,-7.7,-5,-2.4,.2,3,5.8,8.4,11]):
        z=-10.7-(i%3)*1.1;h=3.6+(i%4)*.45;r=1.1+(i%3)*.13
        m.cone(x,-.1,z,.20,h*.63,(66,74,65),6,.13)
        leaf=[(95,105,77),(123,131,85),(152,150,96),(109,121,88)][i%4]
        for k in range(3):m.cone(x,h*(.25+k*.19),z,r*(1-k*.21),h*.40,tuple(min(255,c+k*9) for c in leaf),7,.02)
        for j in range(3):
            m.cone(x+(j-1)*.55,-.03,z+.4,.28,.35,(54,117,94),6,.07)
    # Four separate emplacements at the edge midpoints, leaving the center open.
    for x,z in [(0,7.1),(7.1,0),(0,-7.1),(-7.1,0)]:
        m.cone(x,-.05,z,1.05,.17,(89,76,80),12,.98)
        m.ring(x,.13,z,.94,.055,(189,157,92),40)
        m.ring(x,.14,z,.8,.025,(184,165,132),40)
    cannon=Mesh()
    cannon.cone(0,.12,0,.75,.28,(70,57,68),8,.66)
    cannon.cone(0,.4,0,.56,.52,(145,101,59),8,.48)
    cannon.ring(0,.94,0,.5,.09,(227,190,111),24)
    cannon.beam((0,1.02,-.35),(0,1.22,1.1),.3,(137,62,61),10)
    cannon.beam((0,1.22,.9),(0,1.26,1.18),.35,(220,179,99),10)
    cannon.beam((0,1.265,1.181),(0,1.27,1.19),.235,(28,48,45),10)
    for x in [-.48,.48]:cannon.cone(x,.38,0,.2,.5,(209,171,95),6,.16)
    cannon.cone(0,1.02,-.37,.2,.4,(216,181,136),6,.03)
    return m,cannon
