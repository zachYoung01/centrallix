// Copyright (C) 1998-2001 LightSys Technology Services, Inc.
//
// You may use these files and this library under the terms of the
// GNU Lesser General Public License, Version 2.1, contained in the
// included file "COPYING" or http://www.gnu.org/licenses/lgpl.txt.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Lesser General Public License for more details.

function fs_setvalue(m) {
	this.currentMode = m;
	if (this.currentMode == 'View') {;
		this.document.images[0].src = '/sys/images/formstat01.gif';
	} else if (this.currentMode == 'Modify') {
		this.document.images[0].src = '/sys/images/formstat02.gif';
	} else if (this.currentMode == 'New') {
		this.document.images[0].src = '/sys/images/formstat03.gif';
	} else if (this.currentMode == 'Query') {
		this.document.images[0].src = '/sys/images/formstat04.gif';
	} else {
		this.document.images[0].src = '/sys/images/formstat05.gif';
	}
}

function fs_init(l) {
	l.kind = 'formstatus';
	l.mainlayer = l;
	l.document.layer = l;
	l.document.images[0].layer = l;
	l.document.images[0].mainlayer = l;
	l.document.images[0].kind = 'formstatus';
	l.currentMode = 'NoData';
	l.isFormStatusWidget = true;
	l.setvalue = fs_setvalue;
	if (fm_current) fm_current.Register(l);
	return l;
}
