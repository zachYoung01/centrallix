$Version=2$
index "widget/page"
    {
    title = "Index of Sample Applications";
    bgcolor = "#ffffff";

    cximg "widget/image"
	{
	x=0; y=0; height=66; width=374; 
	source="/sys/images/centrallix_374x66.png";
	}
    cxlabel "widget/label"
	{
	x=414; y=10; height=66; width=200; 
	text="Sample Applications, Reports, etc."; 
	fontsize=5;
	align=center;
	}

    mainpane "widget/pane"
	{
	x=10;y=70;height=400;width=614; 
	style=raised; 
	//bgcolor="#ababfc";
	bgcolor="#e0e0e0";

	treepane "widget/pane"
	    {
	    x=10;y=10;height=378;width=200;
	    style=lowered;
	    bgcolor="#ffffff";

	    tree_scroll "widget/scrollpane"
		{
		x=0;y=0;height=376;width=198;

		samples_tree "widget/treeview"
		    {
		    x=0;y=0;width=178;
		    show_branches=yes;
		    show_root=no;
		    source="/samples/samples.qyt/";

		    tree_click "widget/connector"
		    	{
		    	event="ClickItem";
		    	target=info_html;
		    	action="LoadPage";
		    	Source=runclient(:Pathname + '?ls__type=text%2fplain');
		    	}
		    tree_click2 "widget/connector"
			{
		    	event="ClickItem";
		    	target=ebLaunch;
		    	action="SetValue";
		    	Value=runclient(:Pathname);
			}
		    }
		}
	    }

	infopane "widget/pane"
	    {
	    x=220;y=40;height=348;width=384;
	    style=lowered;
	    bgcolor="#ffffff";

	    info_scroll "widget/scrollpane"
		{
		x=0;y=0;height=346;width=382;

		info_html "widget/html"
		    {
		    x=1;y=0;width = 360;
		    mode=dynamic;
		    source="/samples/welcome.html";
		    }
		}
	    }

	btnLaunch "widget/textbutton"
	    {
	    x=524;y=10;height=20;width=80;
	    text = "Launch...";
	    tristate=no;
	    background="/sys/images/grey_gradient.png";
	    fgcolor1=black; fgcolor2=white;

	    btn_click "widget/connector"
		{
		event="Click";
		target=index;
		action="Launch";
		Width=runclient(640);
		Height=runclient(480);
		Source=runclient(:ebLaunch:content);
		}
	    }
	ebLaunch "widget/editbox"
	    {
	    x=220;y=10;height=20;width=294;
	    style=lowered;
	    bgcolor=white;
	    }
	}
    }
